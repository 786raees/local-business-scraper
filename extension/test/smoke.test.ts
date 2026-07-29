import { describe, expect, it } from 'vitest'
import type { PanelToBg } from '../src/shared/messages'
import type { CallOutcome, SessionSnapshot } from '../src/shared/types'

describe('shared contracts (story 00 smoke)', () => {
  it('message kinds discriminate', () => {
    const msg: PanelToBg = { kind: 'session/start', fromRow: 213 }
    expect(msg.kind).toBe('session/start')
  })

  it('call outcomes match the sheet dropdown vocabulary', () => {
    // Hand-kept in sync with CHANNELS[0] in server/src/sheets/sheetTemplate.ts.
    const outcomes: CallOutcome[] = [
      'No Answer', 'Voicemail', 'Answered', 'Interested',
      'Not Interested', 'Callback', 'Wrong Number', 'DNC',
    ]
    expect(outcomes).toHaveLength(8)
  })

  it('a fresh snapshot is representable', () => {
    const snapshot: SessionSnapshot = {
      phase: 'setup',
      leads: { total: 0, skippedNoPhone: 0, dialable: 0 },
      filter: 'uncalled',
      cursor: 0,
      callState: 'idle',
      unsyncedOutcomes: 0,
    }
    expect(snapshot.phase).toBe('setup')
  })
})
