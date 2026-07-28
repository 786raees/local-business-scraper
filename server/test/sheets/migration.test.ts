import { describe, it, expect } from 'vitest'
import { migrateLegacyStatus } from '../../scripts/migrate-sheet.js'
import { STAGE_VALUES, CHANNELS } from '../../src/sheets/sheetTemplate.js'

const callValues = CHANNELS[0].values

describe('migrateLegacyStatus', () => {
  it('keeps New as a stage with no call outcome', () => {
    expect(migrateLegacyStatus('New')).toEqual({ stage: 'New', call: '' })
  })

  it('splits a call outcome into stage plus call status', () => {
    expect(migrateLegacyStatus('Called-No Answer')).toEqual({ stage: 'Contacted', call: 'No Answer' })
    expect(migrateLegacyStatus('Called-VM')).toEqual({ stage: 'Contacted', call: 'Voicemail' })
    expect(migrateLegacyStatus('Called-Interested')).toEqual({ stage: 'Interested', call: 'Interested' })
  })

  it('carries deal stages across unchanged', () => {
    for (const s of ['Demo Booked', 'Trial Active', 'Closed-Won', 'Closed-Lost']) {
      expect(migrateLegacyStatus(s)).toEqual({ stage: s, call: '' })
    }
  })

  it('maps rejection states to both stage and call status', () => {
    expect(migrateLegacyStatus('Not Interested')).toEqual({ stage: 'Not Interested', call: 'Not Interested' })
    expect(migrateLegacyStatus('DNC')).toEqual({ stage: 'DNC', call: 'DNC' })
  })

  it('defaults an unrecognised or blank value to New', () => {
    expect(migrateLegacyStatus('')).toEqual({ stage: 'New', call: '' })
    expect(migrateLegacyStatus('Nonsense')).toEqual({ stage: 'New', call: '' })
  })

  it('only ever emits values that exist in the vocabularies', () => {
    for (const legacy of ['New', 'Called-No Answer', 'Called-VM', 'Called-Interested',
      'Demo Booked', 'Trial Active', 'Closed-Won', 'Closed-Lost', 'Not Interested', 'DNC']) {
      const { stage, call } = migrateLegacyStatus(legacy)
      expect(STAGE_VALUES).toContain(stage)
      if (call) expect(callValues).toContain(call)
    }
  })
})
