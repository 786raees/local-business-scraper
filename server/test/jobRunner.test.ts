import { describe, it, expect, vi } from 'vitest'
import { expandTasks, locationToQuery, JobRunner } from '../src/queue/jobRunner.js'
import { LocationSpec, JobEvent, emptyBusiness } from '../src/types.js'

const loc = (city: string, zip: string | null): LocationSpec => ({
  country: 'United States', state: 'Florida', city, zip,
  label: `US › Florida › ${city} › ${zip ?? 'All zip codes'}`,
})

describe('expandTasks', () => {
  it('produces keyword × location cartesian product', () => {
    const tasks = expandTasks(['plumber', 'roofer'], [loc('Miami', null), loc('Tampa', '33601')])
    expect(tasks).toHaveLength(4)
    expect(tasks[0]).toMatchObject({ keyword: 'plumber', location: { city: 'Miami' } })
  })
})

describe('locationToQuery', () => {
  it('omits zip when null', () => {
    expect(locationToQuery(loc('Miami', null))).toBe('Miami, Florida, United States')
  })
  it('appends zip when present', () => {
    expect(locationToQuery(loc('Tampa', '33601'))).toBe('Tampa, Florida, United States 33601')
  })
})

const SETTINGS = {
  maxResults: 5, extractEmail: false, headless: true, delayMinMs: 0, delayMaxMs: 0,
} as any

describe('JobRunner', () => {
  it('runs tasks sequentially and emits row + job-done', async () => {
    const fakeScrape = vi.fn(async (kw: string, location: string, _s, onRow) => {
      const b = emptyBusiness(kw, location); b.name = `${kw}-biz`; onRow(b); return [b]
    })
    const events: JobEvent[] = []
    const runner = new JobRunner(fakeScrape as any)
    await runner.run(['plumber'], [loc('Miami', null)], SETTINGS, (e) => events.push(e))
    expect(events.some((e) => e.type === 'row')).toBe(true)
    expect(events.some((e) => e.type === 'task-update' && e.status === 'done')).toBe(true)
    expect(events.at(-1)).toEqual({ type: 'job-done' })
  })
})

describe('JobRunner lifecycle (story 06 — one browser per job)', () => {
  const lifecycleSpies = () => ({
    start: vi.fn(async () => {}),
    drain: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  })

  it('starts the session once per run, drains, then closes — before job-done', async () => {
    const lc = lifecycleSpies()
    const order: string[] = []
    lc.drain.mockImplementation(async () => { order.push('drain') })
    lc.close.mockImplementation(async () => { order.push('close') })
    const events: JobEvent[] = []
    const runner = new JobRunner(vi.fn(async () => []) as any, undefined, undefined, lc)
    await runner.run(['a', 'b'], [loc('Miami', null)], SETTINGS,
      (e) => { if (e.type === 'job-done') order.push('job-done'); events.push(e) })
    expect(lc.start).toHaveBeenCalledTimes(1)
    expect(order).toEqual(['drain', 'close', 'job-done'])
  })

  it('closes the session even when the run is aborted, skipping the drain', async () => {
    const lc = lifecycleSpies()
    const runner = new JobRunner((async () => { runner.stop(); return [] }) as any,
      undefined, undefined, lc)
    await runner.run(['a', 'b'], [loc('Miami', null)], SETTINGS, () => {})
    expect(lc.close).toHaveBeenCalledTimes(1)
    expect(lc.drain).not.toHaveBeenCalled()
  })

  it('fails the whole job visibly when the session cannot start', async () => {
    const lc = lifecycleSpies()
    lc.start.mockImplementation(async () => { throw new Error('no chromium') })
    const scrape = vi.fn(async () => [])
    const events: JobEvent[] = []
    const runner = new JobRunner(scrape as any, undefined, undefined, lc)
    await runner.run(['a'], [loc('Miami', null)], SETTINGS, (e) => events.push(e))
    expect(scrape).not.toHaveBeenCalled()
    expect(events.some((e) => e.type === 'task-update' && e.status === 'error')).toBe(true)
    expect(events.at(-1)).toEqual({ type: 'job-done' })
  })
})

describe('JobRunner enrichment updates (story 06)', () => {
  it('re-emits updates flagged, and they consume no budget', async () => {
    // Each task emits one real row, then an enrichment update for it.
    const fakeScrape = vi.fn(async (kw: string, location: string, _s, onRow) => {
      const b = emptyBusiness(kw, location); b.name = 'x'; b.placeId = kw
      onRow(b)
      onRow({ ...b, email: 'late@enrich.com' }, true)
      return [b]
    })
    const events: JobEvent[] = []
    const runner = new JobRunner(fakeScrape as any)
    await runner.run(['a', 'b', 'c'], [loc('Miami', null)],
      { ...SETTINGS, maxResults: 3 }, (e) => events.push(e))
    const rows = events.filter((e) => e.type === 'row') as Extract<JobEvent, { type: 'row' }>[]
    expect(rows.filter((r) => r.update).length).toBe(3)
    expect(rows.filter((r) => !r.update).length).toBe(3)
    // Budget of 3 was met by the 3 real rows — updates did not end the job early,
    // nor did they count double: all three tasks ran.
    expect(fakeScrape).toHaveBeenCalledTimes(3)
  })
})
