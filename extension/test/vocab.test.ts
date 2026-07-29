import { describe, expect, it } from 'vitest'
import { CALL_STATUS_VALUES, OUTCOME_BUCKET } from '../src/sheets/vocab'

describe('Call Status vocabulary', () => {
  it('matches the sheet dropdown (CHANNELS[0] in sheetTemplate.ts) verbatim, in order', () => {
    expect(CALL_STATUS_VALUES).toEqual([
      'No Answer', 'Voicemail', 'Answered', 'Interested',
      'Not Interested', 'Callback', 'Wrong Number', 'DNC',
    ])
  })

  it('buckets every outcome, mirroring OUTCOME_COLOURS (Voicemail is neutral — sheet wins)', () => {
    expect(Object.keys(OUTCOME_BUCKET).sort()).toEqual([...CALL_STATUS_VALUES].sort())
    expect(OUTCOME_BUCKET['Answered']).toBe('positive')
    expect(OUTCOME_BUCKET['Interested']).toBe('positive')
    expect(OUTCOME_BUCKET['Callback']).toBe('pending')
    expect(OUTCOME_BUCKET['Voicemail']).toBe('neutral')
    expect(OUTCOME_BUCKET['No Answer']).toBe('neutral')
    expect(OUTCOME_BUCKET['DNC']).toBe('negative')
  })
})
