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

/** The status axis of the dial criteria (UX S3.5) — the original v1 filter. */
export type DialFilter = 'all' | 'uncalled' | 'retry'

/** Line-type filter values. 'unknown' explicitly matches blank/absent cells. */
export type LineTypeFilter = 'mobile' | 'landline' | 'voip' | 'unknown'

export interface NumberFilter {
  op: 'lt' | 'gte'
  value: number
}

/**
 * Composable dial-list criteria (story 14): AND across axes, OR within a
 * multi-select axis. Absent/empty optional axes mean "any". Evaluated ONLY by
 * matchesFilter in background/leads.ts — no component filters on its own.
 */
export interface DialCriteria {
  status: DialFilter
  lineTypes?: LineTypeFilter[]
  website?: 'any' | 'has' | 'none'
  reviewCount?: NumberFilter
  /** 1.0–5.0. Blank/NaN cells count as blank, never 0 (story 14 decision 5). */
  rating?: NumberFilter
  /** Sheet Stage values. */
  stages?: string[]
  /** Logged Call Status values. */
  outcomes?: CallOutcome[]
}

/** Leads excluded ONLY because a filtered value is blank (story 14 decision 3). */
export interface BlankExclusions {
  rating: number
  reviewCount: number
  lineType: number
}

export interface SessionSnapshot {
  phase: SessionPhase
  spreadsheet?: { id: string; name: string }
  tab?: { title: string; rowCount: number }
  leads: {
    total: number
    skippedNoPhone: number
    dialable: number
    /** Present when an active blank-sensitive filter excluded leads for blank data. */
    excludedBlank?: BlankExclusions
  }
  criteria: DialCriteria
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
  /** Story 15: recording state for the panel chip/notice. Absent = disabled. */
  recording?: 'on' | 'failed'
  /**
   * Story 16: the just-ended call's kept recording, for the S5 strip. The
   * download id deliberately never crosses the wire — the panel asks the
   * worker to discard, it never touches chrome.downloads itself.
   */
  lastRecording?: { file: string; durationMs: number }
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
