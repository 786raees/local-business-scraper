import { describe, expect, it } from 'vitest'
import { CallStateTracker } from '../src/content/callState'

const widget = (timerText: string | null) => ({ widgetPresent: true, timerText })
const noWidget = { widgetPresent: false, timerText: null }

describe('CallStateTracker', () => {
  it('is inert while idle — manual Voice browsing emits nothing', () => {
    const t = new CallStateTracker()
    expect(t.update(widget('0:05'))).toBeNull()
    expect(t.update(noWidget)).toBeNull()
    expect(t.current).toBe('idle')
  })

  it('answered call: dialing → ringing → in-call → ended', () => {
    const t = new CallStateTracker()
    expect(t.dialRequested()).toBe('dialing')
    expect(t.update(noWidget)).toBeNull()            // still dialing, widget not up yet
    expect(t.update(widget(null))).toBe('ringing')   // widget up, no timer
    expect(t.update(widget('0:00'))).toBeNull()      // timer shown but not advancing yet
    expect(t.update(widget('0:01'))).toBe('in-call') // timer advanced → connected
    expect(t.update(widget('0:02'))).toBeNull()      // stays in-call, no re-emit
    expect(t.update(noWidget)).toBe('ended')
  })

  it('unanswered call: dialing → ringing → ended, never in-call', () => {
    const t = new CallStateTracker()
    t.dialRequested()
    expect(t.update(widget(null))).toBe('ringing')
    expect(t.update(widget(null))).toBeNull()
    expect(t.update(noWidget)).toBe('ended')
  })

  it('static timer text never counts as connected', () => {
    const t = new CallStateTracker()
    t.dialRequested()
    expect(t.update(widget('0:00'))).toBe('ringing')
    expect(t.update(widget('0:00'))).toBeNull() // same digits → still ringing
    expect(t.current).toBe('ringing')
  })

  it('stays quiet after ended until reset, then a new dial restarts the cycle', () => {
    const t = new CallStateTracker()
    t.dialRequested()
    t.update(widget(null))
    t.update(noWidget) // ended
    expect(t.update(widget('0:09'))).toBeNull() // post-call DOM noise ignored
    t.reset()
    expect(t.current).toBe('idle')
    expect(t.dialRequested()).toBe('dialing')
    expect(t.update(widget(null))).toBe('ringing')
  })

  it('extracts the timer from surrounding label text', () => {
    const t = new CallStateTracker()
    t.dialRequested()
    t.update(widget('Call duration 0:07'))
    expect(t.update(widget('Call duration 0:08'))).toBe('in-call')
  })
})
