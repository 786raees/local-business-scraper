import { SheetsAuth } from '../sheets/auth'
import { SheetsApiError, SheetsClient } from '../sheets/client'
import { validateTab } from '../sheets/mapping'
import {
  keyStore,
  resumeStore,
  selectionStore,
  sessionTokenStore,
  settingsStore,
} from '../shared/storage'
import type { BgToPanel, ContentToBg, PanelToBg, Result, TabInfo } from '../shared/messages'
import type { CallState, DialCriteria, SessionSnapshot, SpreadsheetRef } from '../shared/types'
import { DEFAULT_CRITERIA, sanitizeCriteria } from '../shared/criteria'
import {
  dialableLeads,
  explainExclusion,
  findCursorByName,
  findCursorForRow,
  loadLeads,
  reanchorCursor,
  tabVocab,
} from './leads'
import {
  SHEET_CHANGED_ERROR,
  applyWriteToLead,
  namesMatch,
  notesAppend,
  outcomeCells,
  withRecordingNote,
} from './outcomes'
import {
  discardRecording,
  recordingFileName,
  shouldAutoDiscard,
  startRecording,
  stopRecording,
} from './recorder'
import { cellRange } from '../sheets/client'
import { WriteQueue } from './writeQueue'
import type { QueueEntry, QueueState, QueueStore, WriteResult } from './writeQueue'
import { reduce } from './session'
import type { Effect, SessionEvent } from './session'
import {
  buildSnapshot,
  chromeSessionKV,
  consumeRecordingForOutcome,
  freshState,
  loadState,
  normalizeState,
  persistState,
  restoreRecordingOnUndo,
} from './state'
import type { WorkerState } from './state'
import { ensureVoiceTab, sendToVoice } from './voiceController'
import { BADGE_COLORS } from '../shared/colors'

/**
 * Background service worker — session interpreter + all Sheets/Drive I/O
 * (ARCHITECTURE §1, §7). The pure machine lives in session.ts; this file owns
 * time, alarms, the Voice tab, and persistence. MV3 kills this worker at will,
 * so state rehydrates from chrome.storage.session before any message is
 * answered, and an in-flight call is re-synced via voice/probe (§7.4).
 */

const auth = new SheetsAuth(() => keyStore.get(), sessionTokenStore)
const client = new SheetsClient(auth)

const RINGING_ALARM = 'gvqd-ringing'

let workerState: WorkerState | null = null
let criteria: DialCriteria = DEFAULT_CRITERIA
// The 3s inter-call delay is far below chrome.alarms' 30s floor, so it uses a
// timeout; a worker killed mid-delay resumes via the between-calls rehydration.
let delayTimer: ReturnType<typeof setTimeout> | null = null

const ready: Promise<void> = Promise.all([
  loadState(chromeSessionKV).then((s) => { workerState = normalizeState(s) }),
  settingsStore.get().then((s) => { criteria = s.dialCriteria }),
]).then(() => {
  void resyncAfterRestart()
  // Queue entries persisted by a dead worker drain on startup.
  void queue.init().then(() => queue.drain())
})

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err: unknown) => console.error('[gv-quick-dial] sidePanel behavior failed', err))

/** Re-sync a session the worker died in the middle of (§7.4). */
async function resyncAfterRestart(): Promise<void> {
  if (!workerState) return
  try {
    if (workerState.phase === 'dialing' || workerState.phase === 'in-call') {
      const probe = await sendToVoice<{ state: CallState }>({ kind: 'voice/probe' })
      await dispatch({ type: 'callState', state: probe.state === 'idle' ? 'ended' : probe.state })
    } else if (workerState.phase === 'between-calls') {
      await dispatch({ type: 'delayElapsed' })
    }
  } catch (err) {
    console.warn('[gv-quick-dial] restart resync failed', err)
  }
}

function broadcast(snapshot: SessionSnapshot): void {
  const msg: BgToPanel = { kind: 'state', snapshot }
  chrome.runtime.sendMessage(msg).catch(() => {})
}

function snapshot(): SessionSnapshot {
  const snap = buildSnapshot(workerState, criteria)
  snap.unsyncedOutcomes = queue.dueCount()
  snap.queuePaused = queue.isPaused() || undefined
  return snap
}

async function persistAndBroadcast(): Promise<SessionSnapshot> {
  if (workerState) await persistState(chromeSessionKV, workerState)
  const snap = snapshot()
  broadcast(snap)
  updateBadge(snap)
  return snap
}

// ── Toolbar badge mirrors the call state (DESIGN §7) ───────────────────────

let badgeTimer: ReturnType<typeof setInterval> | null = null

function setBadge(text: string, color?: string): void {
  void chrome.action.setBadgeText({ text })
  if (color) void chrome.action.setBadgeBackgroundColor({ color })
}

function updateBadge(snap: SessionSnapshot): void {
  if (badgeTimer !== null) { clearInterval(badgeTimer); badgeTimer = null }
  if (snap.phase === 'error') {
    setBadge('!', BADGE_COLORS.error)
  } else if (snap.callState === 'in-call' && snap.callStartedAt) {
    const startedAt = snap.callStartedAt
    const tick = () => {
      const sec = Math.max(0, Math.floor((Date.now() - startedAt) / 1000))
      setBadge(`${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`, BADGE_COLORS.inCall)
    }
    tick()
    badgeTimer = setInterval(tick, 1000)
  } else if (snap.callState === 'ringing' || snap.callState === 'dialing') {
    setBadge('☎', BADGE_COLORS.ringing)
  } else if (snap.unsyncedOutcomes > 0) {
    // Red count when writes are stuck and no call is active (DESIGN §7).
    setBadge(String(snap.unsyncedOutcomes), BADGE_COLORS.error)
  } else {
    setBadge('')
  }
}

async function saveResumePoint(): Promise<void> {
  if (!workerState) return
  await resumeStore.set(
    workerState.selection.spreadsheetId,
    workerState.selection.tabTitle,
    { cursor: workerState.cursor, updatedAt: new Date().toISOString() },
  )
}

// ── Session interpreter ────────────────────────────────────────────────────

async function runEffect(effect: Effect): Promise<void> {
  if (!workerState) return
  const settings = await settingsStore.get()
  switch (effect) {
    case 'dial': {
      const lead = dialableLeads(workerState.leads, criteria)[workerState.cursor]
      if (!lead) {
        await dispatch({ type: 'voiceError', reason: 'Lead at cursor disappeared.' })
        return
      }
      // Fire-and-forget: the content script reports failures via voice/error,
      // and the dial response's failure is dispatched below.
      void sendToVoice<{ ok: boolean; result: string }>({ kind: 'voice/dial', phone: lead.phone })
        .catch((err: unknown) => {
          void dispatch({
            type: 'voiceError',
            reason: err instanceof Error ? err.message : String(err),
          })
        })
      return
    }
    case 'hangUp':
      void sendToVoice({ kind: 'voice/hangUp' }).catch(() => {})
      return
    case 'setRingingAlarm':
      await chrome.alarms.create(RINGING_ALARM, { when: Date.now() + settings.ringingTimeoutMs })
      return
    case 'clearRingingAlarm':
      await chrome.alarms.clear(RINGING_ALARM)
      return
    case 'setDelayTimer':
      if (delayTimer !== null) clearTimeout(delayTimer)
      delayTimer = setTimeout(() => {
        delayTimer = null
        void dispatch({ type: 'delayElapsed' })
      }, settings.interCallDelayMs)
      return
    case 'clearDelayTimer':
      if (delayTimer !== null) clearTimeout(delayTimer)
      delayTimer = null
      return
    case 'saveResume':
      await saveResumePoint()
      return
    // Story 15: recording brackets the call. Both effects are fire-and-forget
    // — a capture failure marks the call unrecorded and the session dials on.
    case 'startRecording': {
      if (!settings.recordingEnabled) return
      const state = workerState
      const lead = dialableLeads(state.leads, criteria)[state.cursor]
      if (!lead) return
      void (async () => {
        const tab = await ensureVoiceTab(false)
        if (tab.id === undefined) throw new Error('Voice tab has no id.')
        await startRecording(
          tab.id,
          recordingFileName(state.selection.tabTitle, lead, new Date().toISOString()),
        )
      })().then(
        () => { state.recording = 'on'; void persistAndBroadcast() },
        () => { state.recording = 'failed'; void persistAndBroadcast() },
      )
      return
    }
    case 'stopRecording': {
      const state = workerState
      // Duration on the interpreter's clock — the same one the panel timer
      // shows, so the auto-discard gate and the UI can never disagree.
      const durationMs = state.callStartedAt ? Date.now() - state.callStartedAt : 0
      void stopRecording().then(
        (saved) => {
          state.recording = undefined
          if (!saved) { void persistAndBroadcast(); return }
          if (shouldAutoDiscard(durationMs, settings.recordingMinSeconds)) {
            // Too-short calls never surface — file deleted (story 16 decision 4).
            void discardRecording(saved.downloadId)
          } else if (state.phase === 'awaiting-outcome') {
            state.lastRecording = { ...saved, durationMs }
          }
          // Any other phase (hard stop): the outcome is discarded, so the ref
          // must not linger and attach to a later lead's note — but the file
          // itself stays on disk (story 15: no outcome ⇒ keep, write nothing).
          void persistAndBroadcast()
        },
        () => {
          if (state.recording === 'on') state.recording = 'failed'
          void persistAndBroadcast()
        },
      )
      return
    }
  }
}

async function dispatch(event: SessionEvent): Promise<SessionSnapshot> {
  await ready
  if (!workerState) throw new Error('No leads loaded.')
  const prevPhase = workerState.phase
  const dialable = dialableLeads(workerState.leads, criteria)
  const { core, effects } = reduce(workerState, event, dialable.length)
  workerState = core as WorkerState

  // Interpreter-owned timestamps (reduce is pure — no Date there).
  if (event.type === 'callState' && event.state === 'in-call') {
    workerState.callStartedAt = Date.now()
  }
  if (workerState.phase !== 'in-call' && workerState.phase !== 'awaiting-outcome') {
    workerState.callStartedAt = undefined
  }

  // The undo window: the queued entry isn't due while between-calls. Closing
  // the window any way EXCEPT undo makes it due; undo removes it (UX S5.4–5.5).
  if (prevPhase === 'between-calls' && workerState.phase !== 'between-calls') {
    const entryId = undoableEntryId
    undoableEntryId = null
    if (event.type === 'undo') {
      if (entryId) void queue.remove(entryId)
      const undone = workerState.lastOutcome
      if (undone && workerState.tally?.[undone]) {
        workerState.tally = { ...workerState.tally, [undone]: workerState.tally[undone]! - 1 }
      }
      // The recording survives undo — S5 reopens with Discard still possible
      // (story 16 decision 1).
      restoreRecordingOnUndo(workerState)
    } else if (entryId) {
      void queue.makeDue(entryId)
      workerState.pendingRecording = undefined
    }
    workerState.lastOutcome = undefined
  }

  // Recording indicator/file live only inside the call flow: the notice stays
  // visible through awaiting-outcome, and a skipped call's filename must never
  // leak into the NEXT lead's note (the outcome handler consumes it earlier).
  if (!['dialing', 'in-call', 'awaiting-outcome'].includes(workerState.phase)) {
    workerState.recording = undefined
    workerState.lastRecording = undefined
  }

  for (const effect of effects) await runEffect(effect)
  return persistAndBroadcast()
}

// ── Durable outcome write queue (story 10, ARCH §7.3) ──────────────────────

const QUEUE_SLOT = 'writeQueue'
const QUEUE_ALARM = 'gvqd-queue-drain'

const queueStore: QueueStore = {
  async load() {
    const items = await chrome.storage.local.get(QUEUE_SLOT)
    return (items[QUEUE_SLOT] as QueueState | undefined) ?? null
  },
  async save(state) {
    await chrome.storage.local.set({ [QUEUE_SLOT]: state })
  },
}

/** One entry against the sheet: guard → status cell → notes cell. */
async function executeWrite(entry: QueueEntry): Promise<WriteResult> {
  try {
    // Stale-row guard: a re-sorted sheet means a wrong write — never guess (ARCH §9).
    const nameRows = await client.getValues(
      entry.spreadsheetId, cellRange(entry.tabTitle, entry.cells.nameCell))
    if (!namesMatch(entry.leadName, nameRows[0]?.[0] ?? '')) return 'stale'

    await client.updateCell(
      entry.spreadsheetId, entry.tabTitle, entry.cells.callStatusCell, entry.outcome)

    if (entry.note && entry.cells.notesCell) {
      const existing = await client.getValues(
        entry.spreadsheetId, cellRange(entry.tabTitle, entry.cells.notesCell))
      await client.updateCell(
        entry.spreadsheetId,
        entry.tabTitle,
        entry.cells.notesCell,
        notesAppend(existing[0]?.[0] ?? '', entry.note, new Date().toISOString()),
      )
    }
    return 'ok'
  } catch (err) {
    if (err instanceof SheetsApiError && (err.status === 403 || err.status === 401)) {
      return 'denied'
    }
    return 'transient'
  }
}

const queue = new WriteQueue(queueStore, executeWrite, {
  async onWritten(entry) {
    if (!workerState || workerState.selection.tabTitle !== entry.tabTitle) return
    const before = dialableLeads(workerState.leads, criteria)
    const i = workerState.leads.findIndex((l) => l.rowIndex === entry.rowIndex)
    if (i !== -1) {
      workerState.leads[i] = applyWriteToLead(workerState.leads[i], entry, new Date().toISOString())
    }
    // The write can shrink the filtered list (e.g. `uncalled` drops the
    // just-called lead) — re-anchor so the cursor still points at the same
    // next business instead of skipping one.
    const after = dialableLeads(workerState.leads, criteria)
    workerState.cursor = reanchorCursor(before, after, workerState.cursor)
    await saveResumePoint()
    await persistAndBroadcast()
  },
  async onStale() {
    if (!workerState) return
    workerState.phase = 'error'
    workerState.error = SHEET_CHANGED_ERROR
    await persistAndBroadcast()
  },
  onChanged() {
    const snap = snapshot()
    broadcast(snap)
    updateBadge(snap)
  },
})

/** The entry still inside its undo window, if any. */
let undoableEntryId: string | null = null

chrome.alarms.create(QUEUE_ALARM, { periodInMinutes: 1 }).catch(() => {})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === RINGING_ALARM) void dispatch({ type: 'ringingTimeout' })
  if (alarm.name === QUEUE_ALARM) void queue.drain()
})

// ── Sheets/Drive handlers (stories 02–05) ──────────────────────────────────

async function listSpreadsheets(): Promise<SpreadsheetRef[]> {
  return client.listSpreadsheets()
}

/** Tabs annotated with why they can't be used (UX S2 — explained, never hidden). */
async function listTabs(spreadsheetId: string): Promise<TabInfo[]> {
  const tabs = await client.getTabs(spreadsheetId)
  return Promise.all(
    tabs.map(async (tab) => {
      const rows = await client.getValues(
        spreadsheetId,
        `'${tab.title.replace(/'/g, "''")}'!1:1`,
      )
      return { ...tab, missing: validateTab(rows[0] ?? []).missing }
    }),
  )
}

function loadingSnapshot(
  spreadsheetId: string,
  spreadsheetName: string,
  tabTitle: string,
  count: number,
): SessionSnapshot {
  return {
    phase: 'loading-leads',
    spreadsheet: { id: spreadsheetId, name: spreadsheetName },
    tab: { title: tabTitle, rowCount: count },
    leads: { total: count, skippedNoPhone: 0, dialable: 0 },
    criteria,
    cursor: 0,
    callState: 'idle',
    unsyncedOutcomes: 0,
  }
}

async function handleLoadLeads(
  spreadsheetId: string,
  spreadsheetName: string,
  tabTitle: string,
): Promise<SessionSnapshot> {
  broadcast(loadingSnapshot(spreadsheetId, spreadsheetName, tabTitle, 0))
  const result = await loadLeads(client, spreadsheetId, tabTitle, (count) => {
    broadcast(loadingSnapshot(spreadsheetId, spreadsheetName, tabTitle, count))
  })

  const resume = await resumeStore.get(spreadsheetId, tabTitle)
  workerState = freshState(
    {
      selection: { spreadsheetId, spreadsheetName, tabTitle },
      mapping: result.mapping,
      leads: result.leads,
      skippedNoPhone: result.skippedNoPhone,
    },
    resume?.cursor ?? 0,
  )
  return persistAndBroadcast()
}

async function handle(msg: PanelToBg): Promise<unknown> {
  await ready
  switch (msg.kind) {
    case 'panel/hydrate':
      return snapshot()
    case 'sheets/listSpreadsheets':
      return listSpreadsheets()
    case 'sheets/listTabs':
      return listTabs(msg.spreadsheetId)
    case 'sheets/loadLeads': {
      const selection = await selectionStore.get()
      const name = selection?.spreadsheetName ?? msg.spreadsheetId
      return handleLoadLeads(msg.spreadsheetId, name, msg.sheetTitle)
    }
    case 'session/setCriteria': {
      // Changing criteria reshapes the dialable list — re-anchor so the
      // current next-to-dial lead is neither skipped nor repeated (story 14).
      const before = workerState ? dialableLeads(workerState.leads, criteria) : null
      criteria = sanitizeCriteria(msg.criteria)
      await settingsStore.set({ dialCriteria: criteria })
      if (workerState && before) {
        const after = dialableLeads(workerState.leads, criteria)
        workerState.cursor = reanchorCursor(before, after, workerState.cursor)
        workerState.atEnd = false
        await saveResumePoint()
      }
      return persistAndBroadcast()
    }
    case 'session/setCursor': {
      if (!workerState) throw new Error('No leads loaded.')
      const dialable = dialableLeads(workerState.leads, criteria)
      if (msg.rowIndex === null) {
        workerState.cursor = 0
      } else {
        const cursor = findCursorForRow(dialable, msg.rowIndex)
        if (cursor === null) throw new Error(`No dialable lead at or after row ${msg.rowIndex}.`)
        workerState.cursor = cursor
      }
      workerState.atEnd = false
      await saveResumePoint()
      return persistAndBroadcast()
    }
    case 'leads/peek': {
      if (!workerState) throw new Error('No leads loaded.')
      const lead = workerState.leads.find((l) => l.rowIndex === msg.rowIndex)
      return lead ? { name: lead.name } : null
    }
    case 'leads/list': {
      // The start-from picker's dataset: dialable leads only — it must never
      // offer a lead the session wouldn't dial (story 12 out-of-scope rule).
      if (!workerState) throw new Error('No leads loaded.')
      return dialableLeads(workerState.leads, criteria).map((l) => ({
        rowIndex: l.rowIndex, name: l.name, phone: l.phone, callStatus: l.callStatus,
        lineType: l.lineType, lineCarrier: l.lineCarrier,
      }))
    }
    case 'leads/vocab': {
      // Stage/Outcome checklist options — sheet-derived (story 14 decision 4).
      if (!workerState) throw new Error('No leads loaded.')
      return tabVocab(workerState.leads)
    }
    case 'leads/searchAll': {
      // The "filtered out" explanation: is this name in the FULL list, and
      // which criterion excluded it?
      if (!workerState) throw new Error('No leads loaded.')
      const q = msg.query.trim().replace(/\s+/g, ' ').toLowerCase()
      if (!q) return null
      const hit = workerState.leads.find(
        (l) => l.name.trim().replace(/\s+/g, ' ').toLowerCase().includes(q))
      return hit
        ? { name: hit.name, reason: explainExclusion(hit, criteria) ?? 'filtered out' }
        : null
    }
    case 'session/start': {
      if (!workerState) throw new Error('No leads loaded.')
      // A fresh start (not a resume from pause/error) begins a new S6 tally.
      if (workerState.phase === 'ready') workerState.tally = {}
      if (msg.fromRow !== undefined) {
        const dialable = dialableLeads(workerState.leads, criteria)
        const cursor = findCursorForRow(dialable, msg.fromRow)
        if (cursor === null) throw new Error(`No dialable lead at or after row ${msg.fromRow}.`)
        workerState.cursor = cursor
      }
      await ensureVoiceTab(true)
      return dispatch({ type: 'start' })
    }
    case 'session/stop':
      return dispatch({ type: msg.hard ? 'stopHard' : 'stopSoft' })
    case 'session/skip':
      return dispatch({ type: 'skip' })
    case 'call/outcome': {
      if (!workerState) throw new Error('No session.')
      if (workerState.phase !== 'awaiting-outcome') return snapshot()
      const lead = dialableLeads(workerState.leads, criteria)[workerState.cursor]
      if (!lead) throw new Error('No lead at cursor.')
      // Enqueue-before-network AND before the transition: the intent is on
      // disk before anything else happens (ARCH §7.3). notBefore holds it
      // through the undo window.
      const settings = await settingsStore.get()
      // The recorded call's filename rides this outcome's Notes write
      // (story 15); the ref is stashed so undo can restore it (story 16).
      const recordingFile = consumeRecordingForOutcome(workerState)
      const entryId = await queue.enqueue({
        rowIndex: lead.rowIndex,
        leadName: lead.name,
        outcome: msg.outcome,
        note: withRecordingNote(msg.note?.trim() || undefined, recordingFile),
        spreadsheetId: workerState.selection.spreadsheetId,
        tabTitle: workerState.selection.tabTitle,
        cells: outcomeCells(workerState.mapping, lead.rowIndex),
        notBefore: Date.now() + settings.interCallDelayMs,
      })
      undoableEntryId = entryId
      workerState.tally = {
        ...workerState.tally,
        [msg.outcome]: (workerState.tally?.[msg.outcome] ?? 0) + 1,
      }
      workerState.lastOutcome = msg.outcome
      const auto = workerState.preselectedNoAnswer && msg.outcome === 'No Answer'
      const snap = await dispatch({ type: 'outcome', outcome: msg.outcome, auto })
      if (snap.phase !== 'between-calls') {
        // No undo window (paused / end of list) — due immediately.
        undoableEntryId = null
        void queue.makeDue(entryId)
      }
      return snap
    }
    case 'queue/list':
      return queue.list().map((e) => ({
        id: e.id, leadName: e.leadName, outcome: e.outcome, ts: e.ts,
      }))
    case 'queue/retry':
      await queue.retry()
      return snapshot()
    case 'session/reloadLeads': {
      // Recovery from the stale-row error: re-read the tab, then re-find the
      // in-progress business by NAME — its row number is no longer trustworthy.
      if (!workerState) throw new Error('No leads loaded.')
      const { selection } = workerState
      const previousName =
        dialableLeads(workerState.leads, criteria)[workerState.cursor]?.name ?? ''
      const snap = await handleLoadLeads(
        selection.spreadsheetId, selection.spreadsheetName, selection.tabTitle)
      if (workerState && previousName) {
        const dialable = dialableLeads(workerState.leads, criteria)
        const cursor = findCursorByName(dialable, previousName)
        if (cursor !== null) {
          workerState.cursor = cursor
          await saveResumePoint()
          return persistAndBroadcast()
        }
      }
      return snap
    }
    case 'recording/discard': {
      // Valid only while a kept recording is showing (S5, incl. undo-reopened).
      if (!workerState?.lastRecording) return snapshot()
      const { downloadId } = workerState.lastRecording
      workerState.lastRecording = undefined
      // Deletion failure still drops the ref: a Notes line pointing at a
      // missing file is worse than a lost file (story 16 decision 3).
      void discardRecording(downloadId)
      return persistAndBroadcast()
    }
    case 'session/undo':
      return dispatch({ type: 'undo' })
    case 'session/dialNow':
      return dispatch({ type: 'delayElapsed' })
    // Dev-harness passthroughs (story 06)
    case 'dev/voiceDial':
      return sendToVoice({ kind: 'voice/dial', phone: msg.phone })
    case 'dev/voiceHangUp':
      return sendToVoice({ kind: 'voice/hangUp' })
    case 'dev/voiceProbe':
      return sendToVoice({ kind: 'voice/probe' })
    default:
      throw new Error(`Unhandled message: ${(msg as { kind: string }).kind}`)
  }
}

chrome.runtime.onMessage.addListener(
  (msg: PanelToBg | ContentToBg, sender, sendResponse: (r: Result<unknown>) => void) => {
    // Content-script events feed the session machine.
    if (msg.kind === 'voice/callState' || msg.kind === 'voice/error') {
      if (sender.tab && workerState) {
        if (msg.kind === 'voice/callState') {
          void dispatch({ type: 'callState', state: msg.state }).catch(() => {})
        } else {
          void dispatch({ type: 'voiceError', reason: msg.reason }).catch(() => {})
        }
      }
      return false
    }
    handle(msg).then(
      (data) => sendResponse({ ok: true, data }),
      (err: unknown) => sendResponse({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        status: err instanceof SheetsApiError ? err.status : undefined,
      }),
    )
    return true
  },
)

console.log('[gv-quick-dial] background service worker alive')
