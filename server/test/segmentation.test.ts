import { describe, it, expect, vi } from 'vitest'
import { expandSegmentedTasks, JobRunner } from '../src/queue/jobRunner.js'
import { LocationSpec, JobSettings, JobEvent, emptyBusiness } from '../src/types.js'
import type { GeoArea } from '../src/geo/geocode.js'

const loc = (city: string): LocationSpec => ({
  country: 'United Kingdom', state: 'England', city, zip: null,
  label: `UK › England › ${city}`,
})

// ~11km tall, ~7km wide at this latitude.
const LONDON_AREA: GeoArea = {
  lat: 51.5, lng: -0.12, displayName: 'Greater London',
  bbox: { south: 51.45, west: -0.17, north: 51.55, east: -0.07 },
}

const settings = (over: Partial<JobSettings> = {}): JobSettings => ({
  maxResults: 50, extractEmail: false, findOwner: false, headless: true,
  delayMinMs: 0, delayMaxMs: 0,
  segment: true, tileKm: 5, maxTiles: 500,
  ...over,
})

const geoOk = async () => LONDON_AREA

describe('expandSegmentedTasks', () => {
  it('produces one task per tile per keyword', async () => {
    const tasks = await expandSegmentedTasks(['dentist'], [loc('London')], settings(), geoOk)
    expect(tasks.length).toBeGreaterThan(1)
    expect(tasks.every((t) => t.viewport)).toBe(true)
    expect(tasks.every((t) => t.keyword === 'dentist')).toBe(true)
  })

  it('multiplies tiles across keywords', async () => {
    const one = await expandSegmentedTasks(['dentist'], [loc('London')], settings(), geoOk)
    const two = await expandSegmentedTasks(['dentist', 'plumber'], [loc('London')], settings(), geoOk)
    expect(two).toHaveLength(one.length * 2)
  })

  it('gives every task a distinct id', async () => {
    const tasks = await expandSegmentedTasks(['dentist', 'plumber'], [loc('London')], settings(), geoOk)
    expect(new Set(tasks.map((t) => t.id)).size).toBe(tasks.length)
  })

  it('uses a smaller tile size to produce more tiles', async () => {
    const coarse = await expandSegmentedTasks(['d'], [loc('London')], settings({ tileKm: 10 }), geoOk)
    const fine = await expandSegmentedTasks(['d'], [loc('London')], settings({ tileKm: 2 }), geoOk)
    expect(fine.length).toBeGreaterThan(coarse.length)
  })

  it('respects maxTiles so one city cannot flood the queue', async () => {
    const tasks = await expandSegmentedTasks(['d'], [loc('London')], settings({ tileKm: 0.3, maxTiles: 20 }), geoOk)
    // Coarsened to fit rather than truncated, so the count lands at or under the cap
    // while the tiles still span the whole area.
    expect(tasks.length).toBeLessThanOrEqual(20)
    expect(tasks.length).toBeGreaterThan(1)
  })

  it('falls back to a single unsegmented task when geocoding fails', async () => {
    const geoFail = async () => null
    const tasks = await expandSegmentedTasks(['dentist'], [loc('Nowhere')], settings(), geoFail)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].viewport).toBeUndefined()
  })

  it('does not segment at all when the setting is off', async () => {
    const tasks = await expandSegmentedTasks(['dentist'], [loc('London')], settings({ segment: false }), geoOk)
    expect(tasks).toHaveLength(1)
    expect(tasks[0].viewport).toBeUndefined()
  })

  it('labels each tile so the queue panel can show progress meaningfully', async () => {
    const tasks = await expandSegmentedTasks(['dentist'], [loc('London')], settings(), geoOk)
    expect(tasks[0].label).toMatch(/London/)
    expect(tasks[0].label).toMatch(/1\/\d+/)
  })
})

describe('JobRunner with segmentation', () => {
  it('passes each tile viewport through to the scraper', async () => {
    const seen: (unknown | undefined)[] = []
    const fakeScrape = vi.fn(async (kw: string, location: string, _s: JobSettings,
      onRow: (b: any) => void, _sig?: AbortSignal, viewport?: unknown) => {
      seen.push(viewport)
      const b = emptyBusiness(kw, location); b.name = 'x'; onRow(b); return [b]
    })
    const runner = new JobRunner(fakeScrape as any, geoOk as any)
    await runner.run(['dentist'], [loc('London')], settings(), () => {})
    expect(seen.length).toBeGreaterThan(1)
    expect(seen.every((v) => v && typeof (v as any).lat === 'number')).toBe(true)
    // Distinct tiles, not the same viewport repeated.
    expect(new Set(seen.map((v) => `${(v as any).lat},${(v as any).lng}`)).size).toBe(seen.length)
  })

  it('reports total progress across every tile, not just per location', async () => {
    const fakeScrape = vi.fn(async () => [])
    const events: JobEvent[] = []
    const runner = new JobRunner(fakeScrape as any, geoOk as any)
    await runner.run(['dentist'], [loc('London')], settings(), (e) => events.push(e))
    const progress = events.filter((e) => e.type === 'progress') as Extract<JobEvent, { type: 'progress' }>[]
    expect(progress[0].total).toBeGreaterThan(1)
    expect(progress.at(-1)!.done).toBe(progress.at(-1)!.total)
  })

  it('keeps going when one tile fails', async () => {
    let n = 0
    const flaky = vi.fn(async () => {
      if (++n === 2) throw new Error('tile blew up')
      return []
    })
    const events: JobEvent[] = []
    const runner = new JobRunner(flaky as any, geoOk as any)
    await runner.run(['dentist'], [loc('London')], settings(), (e) => events.push(e))
    expect(events.some((e) => e.type === 'task-update' && e.status === 'error')).toBe(true)
    expect(events.at(-1)).toEqual({ type: 'job-done' })
  })

  it('stops mid-grid when aborted', async () => {
    const runner = new JobRunner((async () => { runner.stop(); return [] }) as any, geoOk as any)
    const events: JobEvent[] = []
    await runner.run(['dentist'], [loc('London')], settings(), (e) => events.push(e))
    const done = events.filter((e) => e.type === 'task-update' && e.status === 'running').length
    const total = (events.find((e) => e.type === 'progress') as any).total
    expect(done).toBeLessThan(total)
  })
})

describe('JobRunner total-results budget', () => {
  // maxResults is a whole-job budget: once that many unique rows exist the run stops,
  // part-way through the grid if necessary.
  const tileScrape = (perTile: number) =>
    vi.fn(async (kw: string, location: string, s: JobSettings, onRow: (b: any) => void) => {
      const rows = []
      for (let i = 0; i < Math.min(perTile, s.maxResults); i++) {
        const b = emptyBusiness(kw, location)
        b.name = `biz-${Math.random()}`
        onRow(b); rows.push(b)
      }
      return rows
    })

  /** Runner whose unique count is whatever the fake scraper has emitted so far. */
  const runnerWithBudget = (scrape: any) => {
    let unique = 0
    const wrapped = async (kw: any, loc: any, s: any, onRow: any, sig: any, vp: any) =>
      scrape(kw, loc, s, (b: any) => { unique++; onRow(b) }, sig, vp)
    return new JobRunner(wrapped as any, geoOk as any, () => unique)
  }

  it('stops the whole job once the budget is met', async () => {
    const scrape = tileScrape(10)
    const runner = runnerWithBudget(scrape)
    const events: JobEvent[] = []
    await runner.run(['d'], [loc('London')], settings({ maxResults: 25 }), (e) => events.push(e))
    const rows = events.filter((e) => e.type === 'row').length
    expect(rows).toBe(25)
  })

  it('leaves later tiles unvisited once the budget is met', async () => {
    const scrape = tileScrape(10)
    const runner = runnerWithBudget(scrape)
    await runner.run(['d'], [loc('London')], settings({ maxResults: 25 }), () => {})
    // 25 rows at 10 per tile needs 3 tiles, not the whole grid.
    expect(scrape.mock.calls.length).toBe(3)
  })

  it('passes only the remaining budget to each tile', async () => {
    const scrape = tileScrape(10)
    const runner = runnerWithBudget(scrape)
    await runner.run(['d'], [loc('London')], settings({ maxResults: 25 }), () => {})
    const caps = scrape.mock.calls.map((c: any[]) => c[2].maxResults)
    expect(caps[0]).toBe(25)
    expect(caps[1]).toBe(15)
    expect(caps[2]).toBe(5)
  })

  it('runs the full grid when the budget is never reached', async () => {
    const scrape = tileScrape(1)
    const runner = runnerWithBudget(scrape)
    const tasks = await expandSegmentedTasks(['d'], [loc('London')], settings(), geoOk)
    await runner.run(['d'], [loc('London')], settings({ maxResults: 100_000 }), () => {})
    expect(scrape.mock.calls.length).toBe(tasks.length)
  })

  it('counts unique rows, not raw sightings, against the budget', async () => {
    // Every tile returns rows but the store dedups them all away: the budget is never
    // met, so the run must not stop early on raw row count.
    const scrape = tileScrape(10)
    const runner = new JobRunner(scrape as any, geoOk as any, () => 0)
    await runner.run(['d'], [loc('London')], settings({ maxResults: 25 }), () => {})
    expect(scrape.mock.calls.length).toBeGreaterThan(3)
  })

  it('reports the job as fully progressed when it stops on budget', async () => {
    const runner = runnerWithBudget(tileScrape(10))
    const events: JobEvent[] = []
    await runner.run(['d'], [loc('London')], settings({ maxResults: 25 }), (e) => events.push(e))
    const last = events.filter((e) => e.type === 'progress').at(-1) as any
    expect(last.done).toBe(last.total)
    expect(events.at(-1)).toEqual({ type: 'job-done' })
  })

  it('applies the budget to unsegmented jobs too', async () => {
    const scrape = tileScrape(10)
    let unique = 0
    const wrapped = async (kw: any, l: any, s: any, onRow: any) =>
      scrape(kw, l, s, (b: any) => { unique++; onRow(b) })
    const runner = new JobRunner(wrapped as any, geoOk as any, () => unique)
    const many = [loc('A'), loc('B'), loc('C'), loc('D'), loc('E')]
    await runner.run(['d'], many, settings({ segment: false, maxResults: 15 }), () => {})
    expect(scrape.mock.calls.length).toBe(2)
  })
})
