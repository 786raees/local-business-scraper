import type { HeaderMapping } from '../sheets/mapping'
import { DEFAULT_CRITERIA } from '../shared/criteria'
import type { Selection } from '../shared/storage'
import type { CallOutcome, DialCriteria, Lead, SessionSnapshot } from '../shared/types'
import { dialableLeads, excludedBlankCounts } from './leads'
import { initialCore } from './session'
import type { SessionCore } from './session'

/**
 * Worker-owned session state, checkpointed to chrome.storage.session so a
 * killed service worker rehydrates without a network re-read (ARCHITECTURE §7.4).
 * Pure over an injected KV store for testability.
 */

export interface WorkerState extends SessionCore {
  selection: Required<Selection>
  mapping: HeaderMapping
  leads: Lead[]
  skippedNoPhone: number
  /** Epoch ms when the current call connected (interpreter-owned, not core). */
  callStartedAt?: number
  /** This session's logged outcomes (interpreter-owned). */
  tally?: Partial<Record<CallOutcome, number>>
  /** The just-logged outcome while the undo window is open. */
  lastOutcome?: CallOutcome
  /** Story 15 (interpreter-owned): recording state for the panel. */
  recording?: 'on' | 'failed'
  /** The just-ended call's kept recording, until an outcome consumes it (story 16). */
  lastRecording?: RecordingRef
  /** Stashed by the outcome so undo can restore it (story 16 decision 1). */
  pendingRecording?: RecordingRef
}

/** A recording this session saved — downloadId is the only deletion handle. */
export interface RecordingRef {
  file: string
  downloadId: number
  durationMs: number
}

/**
 * The outcome consumes the recording (its file rides the note) but stashes the
 * ref so undo can bring it back — keep/discard is meaningless if undo silently
 * drops the file reference (story 16 decision 1). Pure for tests.
 */
export function consumeRecordingForOutcome(
  state: Pick<WorkerState, 'lastRecording' | 'pendingRecording'>,
): string | undefined {
  const ref = state.lastRecording
  state.lastRecording = undefined
  state.pendingRecording = ref
  return ref?.file
}

/** Undo reopens S5 with the recording intact (discard still possible there). */
export function restoreRecordingOnUndo(
  state: Pick<WorkerState, 'lastRecording' | 'pendingRecording'>,
): void {
  state.lastRecording = state.pendingRecording
  state.pendingRecording = undefined
}

export function buildSnapshot(
  state: WorkerState | null,
  criteria: DialCriteria = DEFAULT_CRITERIA,
): SessionSnapshot {
  if (!state) {
    return {
      phase: 'pick-sheet',
      leads: { total: 0, skippedNoPhone: 0, dialable: 0 },
      criteria,
      cursor: 0,
      callState: 'idle',
      unsyncedOutcomes: 0,
    }
  }
  const dialable = dialableLeads(state.leads, criteria)
  const cursor = Math.min(state.cursor, Math.max(0, dialable.length - 1))
  const blank = excludedBlankCounts(state.leads, criteria)
  return {
    phase: state.phase,
    spreadsheet: { id: state.selection.spreadsheetId, name: state.selection.spreadsheetName },
    tab: { title: state.selection.tabTitle, rowCount: state.leads.length },
    leads: {
      total: state.leads.length,
      skippedNoPhone: state.skippedNoPhone,
      dialable: dialable.length,
      excludedBlank:
        blank.rating || blank.reviewCount || blank.lineType ? blank : undefined,
    },
    criteria,
    cursor,
    currentLead: dialable[cursor],
    callState: state.callState,
    callStartedAt: state.callStartedAt,
    preselectedOutcome: state.preselectedNoAnswer ? 'No Answer' : undefined,
    atEnd: state.atEnd || undefined,
    unsyncedOutcomes: 0,
    tally: state.tally,
    lastOutcome: state.lastOutcome,
    recording: state.recording,
    // Strips downloadId: the panel never gets a deletion handle (story 16).
    lastRecording: state.lastRecording
      ? { file: state.lastRecording.file, durationMs: state.lastRecording.durationMs }
      : undefined,
    error: state.error,
  }
}

/** Fresh worker state for a just-loaded tab. */
export function freshState(
  base: Omit<WorkerState, keyof SessionCore | 'callStartedAt'>,
  cursor: number,
): WorkerState {
  return { ...base, ...initialCore(cursor) }
}

/** Old checkpoints may predate SessionCore fields — backfill defaults. */
export function normalizeState(raw: WorkerState | null): WorkerState | null {
  if (!raw) return null
  return { ...initialCore(raw.cursor), ...raw }
}

export interface KVStore {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  remove(key: string): Promise<void>
}

const STATE_SLOT = 'session'

export async function persistState(kv: KVStore, state: WorkerState): Promise<void> {
  await kv.set(STATE_SLOT, state)
}

export async function loadState(kv: KVStore): Promise<WorkerState | null> {
  const raw = await kv.get(STATE_SLOT)
  return (raw as WorkerState | undefined) ?? null
}

export async function clearState(kv: KVStore): Promise<void> {
  await kv.remove(STATE_SLOT)
}

/** chrome.storage.session as a KVStore (10MB quota — plenty for lead lists). */
export const chromeSessionKV: KVStore = {
  async get(key) {
    const items = await chrome.storage.session.get(key)
    return items[key]
  },
  async set(key, value) {
    await chrome.storage.session.set({ [key]: value })
  },
  async remove(key) {
    await chrome.storage.session.remove(key)
  },
}
