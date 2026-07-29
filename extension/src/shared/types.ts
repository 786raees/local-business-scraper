/**
 * Domain types shared by every surface. See doc/CHROME_EXTENSION_ARCHITECTURE.md §4.
 */

export interface Lead {
  /** 1-based sheet row — the lead's identity for write-back. */
  rowIndex: number
  name: string
  phone: string
  ownerName?: string
  ownerTitle?: string
  category?: string
  address?: string
  website?: string
  rating?: string
  reviewCount?: string
  stage?: string
  callStatus?: string
  notes?: string
  /** From Atlas's offline NPA-NXX classification (original carrier assignment). */
  lineType?: string
  lineCarrier?: string
}

/**
 * Hand-kept in sync with CHANNELS[0].values in server/src/sheets/sheetTemplate.ts —
 * the sheet's Call Status dropdown, in its exact order.
 */
export type CallOutcome =
  | 'No Answer'
  | 'Voicemail'
  | 'Answered'
  | 'Interested'
  | 'Not Interested'
  | 'Callback'
  | 'Wrong Number'
  | 'DNC'

export type CallState = 'idle' | 'dialing' | 'ringing' | 'in-call' | 'ended'

export type SessionPhase =
  | 'setup'
  | 'pick-sheet'
  | 'pick-tab'
  | 'loading-leads'
  | 'ready'
  | 'dialing'
  | 'in-call'
  | 'awaiting-outcome'
  | 'between-calls'
  | 'paused'
  | 'error'

/** Which loaded rows a session will dial (UX S3.5). */
export type DialFilter = 'all' | 'uncalled' | 'retry'

export interface SessionSnapshot {
  phase: SessionPhase
  spreadsheet?: { id: string; name: string }
  tab?: { title: string; rowCount: number }
  leads: { total: number; skippedNoPhone: number; dialable: number }
  filter: DialFilter
  /** Index into the dialable list. */
  cursor: number
  currentLead?: Lead
  callState: CallState
  /** Epoch ms when the current call connected — panel derives the timer. */
  callStartedAt?: number
  /** Ringing timed out: the outcome screen pre-selects No Answer. */
  preselectedOutcome?: CallOutcome
  /** Cursor walked past the last dialable lead (S6). */
  atEnd?: boolean
  unsyncedOutcomes: number
  /** Queue paused on 403 — retry is pointless until sharing is fixed. */
  queuePaused?: boolean
  /** This session's logged outcomes, for the S6 tally. */
  tally?: Partial<Record<CallOutcome, number>>
  /** The just-logged outcome while the between-calls undo window is open. */
  lastOutcome?: CallOutcome
  error?: string
}

export interface SpreadsheetRef {
  id: string
  name: string
  /** RFC3339, from Drive; drives the "modified 2 days ago" row caption. */
  modifiedTime?: string
}

export interface TabRef {
  sheetId: number
  title: string
  rowCount: number
}
