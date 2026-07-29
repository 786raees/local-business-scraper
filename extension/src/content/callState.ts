import type { CallState } from '../shared/types'

/**
 * Call-state derivation (ARCHITECTURE §6.3). The pure tracker consumes DOM
 * observations and yields state transitions; the observer wiring lives in
 * index.ts. Derivation table:
 *
 *   dial requested, no widget yet            → dialing
 *   widget present, timer absent / not going → ringing
 *   widget present, timer running            → in-call
 *   widget removed after being present       → ended
 */

export interface Observation {
  widgetPresent: boolean
  /** Raw timer text if any (e.g. "0:07"), null when absent. */
  timerText: string | null
}

const TIMER_RE = /\d+:\d{2}/

export class CallStateTracker {
  private state: CallState = 'idle'
  private widgetWasPresent = false
  private lastTimer: string | null = null

  get current(): CallState {
    return this.state
  }

  /** A dial was requested; resets the cycle. */
  dialRequested(): CallState {
    this.state = 'dialing'
    this.widgetWasPresent = false
    this.lastTimer = null
    return this.state
  }

  /**
   * Feed one DOM observation. Returns the new state when it changed, else null.
   * Inert while idle — observations from a Voice tab the user browses manually
   * never produce events (§6.3).
   */
  update(obs: Observation): CallState | null {
    if (this.state === 'idle' || this.state === 'ended') return null

    let next: CallState = this.state
    if (obs.widgetPresent) {
      this.widgetWasPresent = true
      const timerNow = obs.timerText?.match(TIMER_RE)?.[0] ?? null
      // A timer that appears and advances means the call connected.
      const running = timerNow !== null && this.lastTimer !== null && timerNow !== this.lastTimer
      if (timerNow !== null) this.lastTimer = timerNow
      next = running || this.state === 'in-call' ? 'in-call' : 'ringing'
    } else if (this.widgetWasPresent) {
      next = 'ended'
    }

    if (next === this.state) return null
    this.state = next
    return next
  }

  /** Back to inert after the background acknowledges the ended call. */
  reset(): void {
    this.state = 'idle'
    this.widgetWasPresent = false
    this.lastTimer = null
  }
}
