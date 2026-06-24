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

describe('JobRunner', () => {
  it('runs tasks sequentially and emits row + job-done', async () => {
    const fakeScrape = vi.fn(async (kw: string, location: string, _s, onRow) => {
      const b = emptyBusiness(kw, location); b.name = `${kw}-biz`; onRow(b); return [b]
    })
    const events: JobEvent[] = []
    const runner = new JobRunner(fakeScrape as any)
    await runner.run(['plumber'], [loc('Miami', null)],
      { maxResults: 5, extractEmail: false, headless: true, delayMinMs: 0, delayMaxMs: 0 },
      (e) => events.push(e))
    expect(events.some((e) => e.type === 'row')).toBe(true)
    expect(events.some((e) => e.type === 'task-update' && e.status === 'done')).toBe(true)
    expect(events.at(-1)).toEqual({ type: 'job-done' })
  })
})
