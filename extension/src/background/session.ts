import type { CallOutcome, CallState, SessionPhase } from '../shared/types'

/**
 * The dialing-loop state machine (ARCHITECTURE §7.1) as a pure, synchronous
 * transition function. The interpreter in index.ts owns time, alarms, and the
 * Voice tab; this file owns every rule, so vitest can drive the whole matrix.
 *
 *   ready ──start──► dialing ──in-call──► in-call
 *     ▲                │ timeout: hang up, pre-select No Answer   │ ended
 *     │                ▼                                          ▼
 *     └── end of list ◄── between-calls ◄──[outcome/skip]── awaiting-outcome
 */

export interface SessionCore {
  phase: SessionPhase
  /** Index into the dialable list. */
  cursor: number
  callState: CallState
  /** Consecutive auto-logged (timeout) outcomes — the safety valve counter. */
  autoRun: number
  /** Soft stop requested: finish the current call flow, then pause. */
  pendingStop: boolean
  /** Ringing timed out: the outcome screen pre-selects No Answer. */
  preselectedNoAnswer: boolean
  /** Cursor walked past the last dialable lead (S6). */
  atEnd: boolean
  error?: string
}

export const AUTO_RUN_LIMIT = 10

export const initialCore = (cursor = 0): SessionCore => ({
  phase: 'ready',
  cursor,
  callState: 'idle',
  autoRun: 0,
  pendingStop: false,
  preselectedNoAnswer: false,
  atEnd: false,
})

export type SessionEvent =
  | { type: 'start' }
  | { type: 'stopSoft' }
  | { type: 'stopHard' }
  | { type: 'skip' }
  | { type: 'callState'; state: CallState }
  | { type: 'ringingTimeout' }
  | { type: 'delayElapsed' }
  | { type: 'outcome'; outcome: CallOutcome; auto: boolean }
  | { type: 'undo' }
  | { type: 'voiceError'; reason: string }

export type Effect =
  | 'dial'
  | 'hangUp'
  | 'setRingingAlarm'
  | 'clearRingingAlarm'
  | 'setDelayTimer'
  | 'clearDelayTimer'
  | 'saveResume'
  // Story 15: recording brackets the call. Emitted unconditionally; the
  // interpreter no-ops them when recording is disabled in settings.
  | 'startRecording'
  | 'stopRecording'

export interface Transition {
  core: SessionCore
  effects: Effect[]
}

const same = (core: SessionCore): Transition => ({ core, effects: [] })

const ACTIVE_CALL_PHASES: SessionPhase[] = ['dialing', 'in-call']

function startDialing(core: SessionCore): Transition {
  return {
    core: { ...core, phase: 'dialing', callState: 'idle', preselectedNoAnswer: false },
    effects: ['dial', 'setRingingAlarm'],
  }
}

/** Shared advance after a call resolves (outcome logged or lead skipped). */
function advance(core: SessionCore, totalDialable: number, auto: boolean): Transition {
  const cursor = core.cursor + 1
  const autoRun = auto ? core.autoRun + 1 : 0
  const base: SessionCore = {
    ...core, cursor, autoRun, callState: 'idle', preselectedNoAnswer: false,
  }
  if (autoRun >= AUTO_RUN_LIMIT) {
    return {
      core: {
        ...base,
        phase: 'paused',
        pendingStop: false,
        autoRun: 0,
        error: `${AUTO_RUN_LIMIT} calls unanswered in a row — paused.`,
      },
      effects: ['saveResume'],
    }
  }
  if (core.pendingStop) {
    return { core: { ...base, phase: 'paused', pendingStop: false }, effects: ['saveResume'] }
  }
  if (cursor >= totalDialable) {
    return { core: { ...base, phase: 'ready', atEnd: true }, effects: ['saveResume'] }
  }
  return { core: { ...base, phase: 'between-calls' }, effects: ['setDelayTimer', 'saveResume'] }
}

export function reduce(
  core: SessionCore,
  event: SessionEvent,
  totalDialable: number,
): Transition {
  switch (event.type) {
    case 'start': {
      if (!['ready', 'paused', 'error'].includes(core.phase)) return same(core)
      if (totalDialable === 0 || core.cursor >= totalDialable) {
        return {
          core: { ...core, phase: 'error', error: 'No dialable leads to call.' },
          effects: [],
        }
      }
      return startDialing({
        ...core, autoRun: 0, pendingStop: false, atEnd: false, error: undefined,
      })
    }

    case 'callState': {
      if (!ACTIVE_CALL_PHASES.includes(core.phase)) return same(core)
      switch (event.state) {
        case 'dialing':
        case 'ringing':
          return { core: { ...core, callState: event.state }, effects: [] }
        case 'in-call':
          return {
            core: { ...core, phase: 'in-call', callState: 'in-call' },
            effects: ['clearRingingAlarm', 'startRecording'],
          }
        case 'ended':
          return {
            core: { ...core, phase: 'awaiting-outcome', callState: 'ended' },
            // A call that never connected (ended from dialing) has no recording.
            effects: core.phase === 'in-call'
              ? ['clearRingingAlarm', 'stopRecording']
              : ['clearRingingAlarm'],
          }
        default:
          return same(core)
      }
    }

    case 'ringingTimeout': {
      // Never connected: hang up and pre-select No Answer (UX S4/S5).
      if (core.phase !== 'dialing') return same(core)
      return {
        core: {
          ...core, phase: 'awaiting-outcome', callState: 'ended', preselectedNoAnswer: true,
        },
        effects: ['hangUp', 'clearRingingAlarm'],
      }
    }

    case 'outcome': {
      if (core.phase !== 'awaiting-outcome') return same(core)
      return advance(core, totalDialable, event.auto)
    }

    case 'skip': {
      // Pre-connection or on the outcome screen — never mid-conversation (UX S4).
      if (core.phase === 'dialing') {
        const t = advance(core, totalDialable, false)
        return { core: t.core, effects: ['hangUp', 'clearRingingAlarm', ...t.effects] }
      }
      if (core.phase === 'awaiting-outcome') return advance(core, totalDialable, false)
      return same(core)
    }

    case 'undo': {
      // Only within the between-calls window — the write hasn't executed yet
      // (the interpreter defers it until this window closes), so undo is safe.
      if (core.phase !== 'between-calls') return same(core)
      return {
        core: {
          ...core,
          phase: 'awaiting-outcome',
          cursor: Math.max(0, core.cursor - 1),
          callState: 'ended',
          autoRun: 0,
          preselectedNoAnswer: false,
        },
        effects: ['clearDelayTimer'],
      }
    }

    case 'delayElapsed': {
      if (core.phase !== 'between-calls') return same(core)
      if (core.pendingStop) {
        return { core: { ...core, phase: 'paused', pendingStop: false }, effects: ['saveResume'] }
      }
      return startDialing(core)
    }

    case 'stopSoft': {
      // Mid-call-flow: finish the call (incl. outcome), then pause.
      if (ACTIVE_CALL_PHASES.includes(core.phase) || core.phase === 'awaiting-outcome') {
        return same({ ...core, pendingStop: true })
      }
      if (core.phase === 'between-calls') {
        return {
          core: { ...core, phase: 'paused', pendingStop: false },
          effects: ['clearDelayTimer', 'saveResume'],
        }
      }
      return same(core)
    }

    case 'stopHard': {
      // Immediate: hang up, discard the pending outcome, pause.
      const active = ACTIVE_CALL_PHASES.includes(core.phase)
      return {
        core: {
          ...core,
          phase: 'paused',
          callState: 'idle',
          pendingStop: false,
          preselectedNoAnswer: false,
        },
        effects: [
          ...(active ? (['hangUp'] as Effect[]) : []),
          ...(core.phase === 'in-call' ? (['stopRecording'] as Effect[]) : []),
          'clearRingingAlarm', 'clearDelayTimer', 'saveResume',
        ],
      }
    }

    case 'voiceError': {
      // In-call cleanup: never leave a recorder running past the session.
      return {
        core: { ...core, phase: 'error', callState: 'idle', error: event.reason },
        effects: [
          ...(core.phase === 'in-call' ? (['stopRecording'] as Effect[]) : []),
          'clearRingingAlarm', 'clearDelayTimer', 'saveResume',
        ],
      }
    }
  }
}
