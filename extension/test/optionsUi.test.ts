import { describe, expect, it } from 'vitest'
import { recordingSteps } from '../src/options/RecordingSection'

const locks = (steps: ReturnType<typeof recordingSteps>) =>
  Object.fromEntries(steps.map((s) => [s.key, s.locked]))

describe('recordingSteps — the settings dependency chain (story 17 decision 2)', () => {
  it('renders all four steps in order, always (locked ≠ hidden)', () => {
    const steps = recordingSteps({ recordingEnabled: false }, null)
    expect(steps.map((s) => s.key)).toEqual(['consent', 'mic', 'enable', 'duration'])
  })

  it('no consent: everything downstream is locked, consent itself never is', () => {
    expect(locks(recordingSteps({ recordingEnabled: false }, 'granted')))
      .toEqual({ consent: false, mic: true, enable: true, duration: true })
  })

  it('consent unlocks mic; enable stays locked until the mic is granted', () => {
    const consented = { recordingConsentAt: '2026-07-30T00:00:00Z', recordingEnabled: false }
    expect(locks(recordingSteps(consented, 'prompt')))
      .toEqual({ consent: false, mic: false, enable: true, duration: true })
    expect(locks(recordingSteps(consented, 'denied')))
      .toEqual({ consent: false, mic: false, enable: true, duration: true })
    expect(locks(recordingSteps(consented, 'granted')))
      .toEqual({ consent: false, mic: false, enable: false, duration: true })
  })

  it('enabling recording unlocks the duration gate', () => {
    const on = { recordingConsentAt: '2026-07-30T00:00:00Z', recordingEnabled: true }
    expect(locks(recordingSteps(on, 'granted')))
      .toEqual({ consent: false, mic: false, enable: false, duration: false })
  })

  it('done flags mirror the actual state, independent of locks', () => {
    const steps = recordingSteps(
      { recordingConsentAt: '2026-07-30T00:00:00Z', recordingEnabled: true }, 'granted')
    expect(steps.map((s) => s.done)).toEqual([true, true, true, false])
    // Mic revoked later: enable re-locks but still shows as on (state truth).
    const revoked = recordingSteps(
      { recordingConsentAt: '2026-07-30T00:00:00Z', recordingEnabled: true }, 'denied')
    expect(locks(revoked).enable).toBe(true)
    expect(revoked.find((s) => s.key === 'enable')?.done).toBe(true)
  })
})
