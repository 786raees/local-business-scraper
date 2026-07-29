import { describe, expect, it } from 'vitest'
import { AUTO_RUN_LIMIT, initialCore, reduce } from '../src/background/session'
import type { SessionCore, SessionEvent } from '../src/background/session'

const TOTAL = 5

function run(core: SessionCore, events: SessionEvent[], total = TOTAL) {
  let state = core
  const allEffects: string[][] = []
  for (const e of events) {
    const t = reduce(state, e, total)
    state = t.core
    allEffects.push(t.effects)
  }
  return { state, allEffects }
}

describe('happy path', () => {
  it('start → answered call → outcome → between-calls → next dial', () => {
    const t1 = reduce(initialCore(), { type: 'start' }, TOTAL)
    expect(t1.core.phase).toBe('dialing')
    expect(t1.effects).toEqual(['dial', 'setRingingAlarm'])

    const { state, allEffects } = run(t1.core, [
      { type: 'callState', state: 'ringing' },
      { type: 'callState', state: 'in-call' },
      { type: 'callState', state: 'ended' },
      { type: 'outcome', outcome: 'Answered', auto: false },
    ])
    expect(state.phase).toBe('between-calls')
    expect(state.cursor).toBe(1)
    expect(allEffects[1]).toContain('clearRingingAlarm')       // connected clears the alarm
    expect(allEffects[3]).toEqual(['setDelayTimer', 'saveResume'])

    const next = reduce(state, { type: 'delayElapsed' }, TOTAL)
    expect(next.core.phase).toBe('dialing')
    expect(next.effects).toEqual(['dial', 'setRingingAlarm'])
  })

  it('unanswered call goes straight to awaiting-outcome without in-call', () => {
    const { state } = run(reduce(initialCore(), { type: 'start' }, TOTAL).core, [
      { type: 'callState', state: 'ringing' },
      { type: 'callState', state: 'ended' },
    ])
    expect(state.phase).toBe('awaiting-outcome')
    expect(state.preselectedNoAnswer).toBe(false)
  })
})

describe('ringing timeout', () => {
  it('hangs up and pre-selects No Answer', () => {
    const dialing = reduce(initialCore(), { type: 'start' }, TOTAL).core
    const t = reduce(
      reduce(dialing, { type: 'callState', state: 'ringing' }, TOTAL).core,
      { type: 'ringingTimeout' },
      TOTAL,
    )
    expect(t.core.phase).toBe('awaiting-outcome')
    expect(t.core.preselectedNoAnswer).toBe(true)
    expect(t.effects).toEqual(['hangUp', 'clearRingingAlarm'])
  })

  it('is ignored once connected', () => {
    const inCall = run(reduce(initialCore(), { type: 'start' }, TOTAL).core, [
      { type: 'callState', state: 'in-call' },
    ]).state
    const t = reduce(inCall, { type: 'ringingTimeout' }, TOTAL)
    expect(t.core.phase).toBe('in-call')
    expect(t.effects).toEqual([])
  })
})

describe('stop', () => {
  const awaiting = (): SessionCore => run(reduce(initialCore(), { type: 'start' }, TOTAL).core, [
    { type: 'callState', state: 'in-call' },
    { type: 'callState', state: 'ended' },
  ]).state

  it('soft stop mid-call finishes the flow, then pauses after the outcome', () => {
    const inCall = run(reduce(initialCore(), { type: 'start' }, TOTAL).core, [
      { type: 'callState', state: 'in-call' },
    ]).state
    const soft = reduce(inCall, { type: 'stopSoft' }, TOTAL)
    expect(soft.core.phase).toBe('in-call')          // call continues
    expect(soft.core.pendingStop).toBe(true)

    const { state } = run(soft.core, [
      { type: 'callState', state: 'ended' },
      { type: 'outcome', outcome: 'Interested', auto: false },
    ])
    expect(state.phase).toBe('paused')
    expect(state.cursor).toBe(1)                     // outcome still advanced the cursor
  })

  it('soft stop between calls pauses immediately and clears the delay', () => {
    const between = run(awaiting(), [{ type: 'outcome', outcome: 'Answered', auto: false }]).state
    const t = reduce(between, { type: 'stopSoft' }, TOTAL)
    expect(t.core.phase).toBe('paused')
    expect(t.effects).toContain('clearDelayTimer')
  })

  it('hard stop hangs up immediately and discards the pending outcome', () => {
    const inCall = run(reduce(initialCore(), { type: 'start' }, TOTAL).core, [
      { type: 'callState', state: 'in-call' },
    ]).state
    const t = reduce(inCall, { type: 'stopHard' }, TOTAL)
    expect(t.core.phase).toBe('paused')
    expect(t.effects).toContain('hangUp')
    expect(t.core.cursor).toBe(0)                    // no outcome, no advance
  })

  it('resume after pause redials from the cursor', () => {
    const paused = reduce(awaiting(), { type: 'stopHard' }, TOTAL).core
    const t = reduce(paused, { type: 'start' }, TOTAL)
    expect(t.core.phase).toBe('dialing')
    expect(t.effects).toContain('dial')
  })
})

describe('skip', () => {
  it('pre-connection skip hangs up and advances without logging', () => {
    const ringing = run(reduce(initialCore(), { type: 'start' }, TOTAL).core, [
      { type: 'callState', state: 'ringing' },
    ]).state
    const t = reduce(ringing, { type: 'skip' }, TOTAL)
    expect(t.core.cursor).toBe(1)
    expect(t.core.phase).toBe('between-calls')
    expect(t.effects.slice(0, 2)).toEqual(['hangUp', 'clearRingingAlarm'])
  })

  it('is refused mid-conversation', () => {
    const inCall = run(reduce(initialCore(), { type: 'start' }, TOTAL).core, [
      { type: 'callState', state: 'in-call' },
    ]).state
    const t = reduce(inCall, { type: 'skip' }, TOTAL)
    expect(t.core.phase).toBe('in-call')
    expect(t.core.cursor).toBe(0)
  })
})

describe('safety valve', () => {
  it(`pauses after ${AUTO_RUN_LIMIT} consecutive auto-logged calls`, () => {
    let state = initialCore(0)
    for (let i = 0; i < AUTO_RUN_LIMIT; i++) {
      state = reduce(state, { type: 'start' }, 100).core
      state = reduce(state, { type: 'ringingTimeout' }, 100).core
      state = reduce(state, { type: 'outcome', outcome: 'No Answer', auto: true }, 100).core
      if (state.phase === 'between-calls') {
        state = reduce(state, { type: 'delayElapsed' }, 100).core
      }
    }
    expect(state.phase).toBe('paused')
    expect(state.error).toContain('unanswered in a row')
  })

  it('a manual outcome resets the counter', () => {
    let state = initialCore(0)
    state = reduce(state, { type: 'start' }, 100).core
    for (let i = 0; i < AUTO_RUN_LIMIT - 1; i++) {
      state = reduce(state, { type: 'ringingTimeout' }, 100).core
      state = reduce(state, { type: 'outcome', outcome: 'No Answer', auto: true }, 100).core
      state = reduce(state, { type: 'delayElapsed' }, 100).core
    }
    expect(state.autoRun).toBe(AUTO_RUN_LIMIT - 1)
    state = reduce(state, { type: 'callState', state: 'in-call' }, 100).core
    state = reduce(state, { type: 'callState', state: 'ended' }, 100).core
    state = reduce(state, { type: 'outcome', outcome: 'Answered', auto: false }, 100).core
    expect(state.autoRun).toBe(0)
    expect(state.phase).toBe('between-calls')
  })
})

describe('undo', () => {
  const betweenCalls = (): SessionCore => {
    const awaiting = run(reduce(initialCore(), { type: 'start' }, TOTAL).core, [
      { type: 'callState', state: 'in-call' },
      { type: 'callState', state: 'ended' },
    ]).state
    return reduce(awaiting, { type: 'outcome', outcome: 'Answered', auto: false }, TOTAL).core
  }

  it('reopens the outcome screen for the same lead within the countdown', () => {
    const between = betweenCalls()
    expect(between.cursor).toBe(1)
    const t = reduce(between, { type: 'undo' }, TOTAL)
    expect(t.core.phase).toBe('awaiting-outcome')
    expect(t.core.cursor).toBe(0)                 // back to the logged lead
    expect(t.effects).toEqual(['clearDelayTimer'])
  })

  it('is refused outside the between-calls window', () => {
    const awaiting = run(reduce(initialCore(), { type: 'start' }, TOTAL).core, [
      { type: 'callState', state: 'ended' },
    ]).state
    expect(reduce(awaiting, { type: 'undo' }, TOTAL).core.phase).toBe('awaiting-outcome')
    expect(reduce(awaiting, { type: 'undo' }, TOTAL).core.cursor).toBe(awaiting.cursor)
    const paused = reduce(betweenCalls(), { type: 'stopSoft' }, TOTAL).core
    expect(reduce(paused, { type: 'undo' }, TOTAL).core.phase).toBe('paused')
  })

  it('re-logging after undo works (undo → outcome → between-calls)', () => {
    const reopened = reduce(betweenCalls(), { type: 'undo' }, TOTAL).core
    const t = reduce(reopened, { type: 'outcome', outcome: 'Callback', auto: false }, TOTAL)
    expect(t.core.phase).toBe('between-calls')
    expect(t.core.cursor).toBe(1)
  })
})

describe('end of list & errors', () => {
  it('the last outcome lands on ready with atEnd', () => {
    const lastAwaiting = run(
      reduce(initialCore(TOTAL - 1), { type: 'start' }, TOTAL).core,
      [{ type: 'callState', state: 'ended' }],
    ).state
    const t = reduce(lastAwaiting, { type: 'outcome', outcome: 'DNC', auto: false }, TOTAL)
    expect(t.core.phase).toBe('ready')
    expect(t.core.atEnd).toBe(true)
  })

  it('start with an exhausted cursor errors instead of dialing', () => {
    const t = reduce(initialCore(TOTAL), { type: 'start' }, TOTAL)
    expect(t.core.phase).toBe('error')
    expect(t.effects).not.toContain('dial')
  })

  it('voiceError pauses everything; start retries from the cursor', () => {
    const dialing = reduce(initialCore(2), { type: 'start' }, TOTAL).core
    const errored = reduce(dialing, { type: 'voiceError', reason: 'not-logged-in' }, TOTAL)
    expect(errored.core.phase).toBe('error')
    expect(errored.core.error).toBe('not-logged-in')
    expect(errored.effects).toContain('clearRingingAlarm')

    const retry = reduce(errored.core, { type: 'start' }, TOTAL)
    expect(retry.core.phase).toBe('dialing')
    expect(retry.core.cursor).toBe(2)
    expect(retry.core.error).toBeUndefined()
  })

  it('stray events in inert phases are no-ops', () => {
    const ready = initialCore()
    for (const e of [
      { type: 'callState', state: 'ringing' },
      { type: 'ringingTimeout' },
      { type: 'delayElapsed' },
      { type: 'outcome', outcome: 'Answered', auto: false },
      { type: 'skip' },
    ] as SessionEvent[]) {
      const t = reduce(ready, e, TOTAL)
      expect(t.core).toEqual(ready)
      expect(t.effects).toEqual([])
    }
  })
})
