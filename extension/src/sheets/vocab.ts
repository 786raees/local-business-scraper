import type { CallOutcome } from '../shared/types'

/**
 * Hand-kept in sync with CHANNELS[0] in Atlas server/src/sheets/sheetTemplate.ts —
 * the sheet's Call Status dropdown vocabulary, in its exact order. The column's
 * data validation is strict, so any other string would be rejected by the sheet.
 */
export const CALL_STATUS_VALUES: readonly CallOutcome[] = [
  'No Answer',
  'Voicemail',
  'Answered',
  'Interested',
  'Not Interested',
  'Callback',
  'Wrong Number',
  'DNC',
]

export type OutcomeBucket = 'positive' | 'pending' | 'negative' | 'neutral'

/**
 * Outcome → colour bucket, mirroring OUTCOME_COLOURS in sheetTemplate.ts so the
 * panel and the sheet always colour the same value the same way (DESIGN §2.4).
 * Note: the sheet buckets Voicemail as neutral grey — sheet mapping wins.
 */
export const OUTCOME_BUCKET: Record<CallOutcome, OutcomeBucket> = {
  'Answered': 'positive',
  'Interested': 'positive',
  'Callback': 'pending',
  'Not Interested': 'negative',
  'Wrong Number': 'negative',
  'DNC': 'negative',
  'No Answer': 'neutral',
  'Voicemail': 'neutral',
}
