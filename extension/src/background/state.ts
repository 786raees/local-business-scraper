import type { HeaderMapping } from '../sheets/mapping'
import type { Selection } from '../shared/storage'
import type { CallOutcome, DialFilter, Lead, SessionSnapshot } from '../shared/types'
import { dialableLeads } from './leads'
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
}

export function buildSnapshot(
  state: WorkerState | null,
  filter: DialFilter = 'uncalled',
): SessionSnapshot {
  if (!state) {
    return {
      phase: 'pick-sheet',
      leads: { total: 0, skippedNoPhone: 0, dialable: 0 },
      filter,
      cursor: 0,
      callState: 'idle',
      unsyncedOutcomes: 0,
    }
  }
  const dialable = dialableLeads(state.leads, filter)
  const cursor = Math.min(state.cursor, Math.max(0, dialable.length - 1))
  return {
    phase: state.phase,
    spreadsheet: { id: state.selection.spreadsheetId, name: state.selection.spreadsheetName },
    tab: { title: state.selection.tabTitle, rowCount: state.leads.length },
    leads: {
      total: state.leads.length,
      skippedNoPhone: state.skippedNoPhone,
      dialable: dialable.length,
    },
    filter,
    cursor,
    currentLead: dialable[cursor],
    callState: state.callState,
    callStartedAt: state.callStartedAt,
    preselectedOutcome: state.preselectedNoAnswer ? 'No Answer' : undefined,
    atEnd: state.atEnd || undefined,
    unsyncedOutcomes: 0,
    tally: state.tally,
    lastOutcome: state.lastOutcome,
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
