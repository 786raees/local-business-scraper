import type { CallOutcome, CallState, DialFilter, SessionSnapshot } from './types'

/**
 * Every message that crosses a surface boundary. Nothing else does.
 * See doc/CHROME_EXTENSION_ARCHITECTURE.md §4.
 */

export type PanelToBg =
  | { kind: 'panel/hydrate' }
  | { kind: 'sheets/listSpreadsheets' }
  | { kind: 'sheets/listTabs'; spreadsheetId: string }
  | { kind: 'sheets/loadLeads'; spreadsheetId: string; sheetTitle: string }
  | { kind: 'session/start'; fromRow?: number }
  | { kind: 'session/stop'; hard: boolean }
  | { kind: 'session/skip' }
  | { kind: 'session/setFilter'; filter: DialFilter }
  | { kind: 'session/setCursor'; rowIndex: number | null }
  | { kind: 'leads/peek'; rowIndex: number }
  | { kind: 'leads/list' }
  | { kind: 'leads/searchAll'; query: string }
  | { kind: 'call/outcome'; outcome: CallOutcome; note?: string }
  | { kind: 'session/undo' }
  | { kind: 'session/dialNow' }
  | { kind: 'queue/list' }
  | { kind: 'queue/retry' }
  | { kind: 'session/reloadLeads' }
  // Dev-harness passthroughs (story 06; hidden UI, removed with story 07's loop)
  | { kind: 'dev/voiceDial'; phone: string }
  | { kind: 'dev/voiceHangUp' }
  | { kind: 'dev/voiceProbe' }

export type BgToPanel = { kind: 'state'; snapshot: SessionSnapshot }

export type BgToContent =
  | { kind: 'voice/dial'; phone: string }
  | { kind: 'voice/hangUp' }
  | { kind: 'voice/probe' }

export type ContentToBg =
  | { kind: 'voice/callState'; state: CallState }
  | { kind: 'voice/error'; reason: 'not-logged-in' | 'dialer-not-found' | 'dial-failed' }

export type AnyMessage = PanelToBg | BgToPanel | BgToContent | ContentToBg

/** Request/response envelope for panel→background calls that return data. */
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; status?: number }

/** A tab annotated with why it can't be used (empty = usable). Powers UX S2. */
export interface TabInfo {
  sheetId: number
  title: string
  rowCount: number
  missing: string[]
}
