import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { geocode, areaFromLocation } from '../src/geo/geocode.js'

// Shape returned by Nominatim: boundingbox is [south, north, west, east] as strings.
const LONDON_RESPONSE = [{
  lat: '51.5074456',
  lon: '-0.1277653',
  display_name: 'Greater London, England, United Kingdom',
  boundingbox: ['51.2867601', '51.6918741', '-0.5103751', '0.3340155'],
}]

describe('geocode', () => {
  let cacheDir: string
  beforeEach(async () => { cacheDir = await mkdtemp(join(tmpdir(), 'geocode-')) })
  afterEach(async () => { await rm(cacheDir, { recursive: true, force: true }) })

  it('resolves a query to a centre point and bounding box', async () => {
    const area = await geocode('Greater London, England, United Kingdom',
      async () => LONDON_RESPONSE, cacheDir)
    expect(area).not.toBeNull()
    expect(area!.lat).toBeCloseTo(51.5074, 3)
    expect(area!.lng).toBeCloseTo(-0.1278, 3)
    expect(area!.bbox).toEqual({
      south: 51.2867601, north: 51.6918741, west: -0.5103751, east: 0.3340155,
    })
  })

  it('returns null when the place is unknown', async () => {
    expect(await geocode('Nowhereville', async () => [], cacheDir)).toBeNull()
  })

  it('returns null rather than throwing when the service is unreachable', async () => {
    const boom = async () => { throw new Error('ENOTFOUND') }
    expect(await geocode('London', boom, cacheDir)).toBeNull()
  })

  it('caches a hit so the service is queried only once', async () => {
    let calls = 0
    const counting = async () => { calls++; return LONDON_RESPONSE }
    await geocode('London', counting, cacheDir)
    await geocode('London', counting, cacheDir)
    expect(calls).toBe(1)
    expect(await readdir(cacheDir)).toHaveLength(1)
  })

  it('does not cache a miss, so a transient outage is retried', async () => {
    const boom = async () => { throw new Error('offline') }
    await geocode('London', boom, cacheDir)
    expect(await readdir(cacheDir)).toHaveLength(0)
  })

  it('sends a descriptive User-Agent, which Nominatim requires', async () => {
    let seenInit: any
    const spy = async (_url: string, init?: any) => { seenInit = init; return LONDON_RESPONSE }
    await geocode('London', spy, cacheDir)
    expect(String(seenInit?.headers?.['User-Agent'] ?? '')).toMatch(/\w+\/[\d.]+/)
  })
})

describe('areaFromLocation', () => {
  let cacheDir: string
  let seenUrl: string
  const spy = async (url: string) => { seenUrl = url; return LONDON_RESPONSE }
  const params = () => Object.fromEntries(new URL(seenUrl).searchParams)

  beforeEach(async () => { cacheDir = await mkdtemp(join(tmpdir(), 'geocode-')); seenUrl = '' })
  afterEach(async () => { await rm(cacheDir, { recursive: true, force: true }) })

  // Free-text "Berlin, Berlin, Germany" makes Nominatim return a street, and
  // "Madrid, Madrid, Spain" returns the national library. The structured
  // city/state/country parameters return the administrative area in both cases.
  it('uses structured query parameters, not a free-text q', async () => {
    await areaFromLocation(
      { country: 'United Kingdom', state: 'England', city: 'Greater London', zip: null, label: '' },
      spy, cacheDir,
    )
    expect(params()).toMatchObject({
      city: 'Greater London', state: 'England', country: 'United Kingdom',
    })
    expect(params().q).toBeUndefined()
  })

  it('omits a state that merely repeats the city name', async () => {
    await areaFromLocation(
      { country: 'Germany', state: 'Berlin', city: 'Berlin', zip: null, label: '' },
      spy, cacheDir,
    )
    expect(params().city).toBe('Berlin')
    expect(params().state).toBeUndefined()
  })

  it('uses the postal code to narrow the area when one is chosen', async () => {
    await areaFromLocation(
      { country: 'United Kingdom', state: 'England', city: 'Manchester', zip: 'M1', label: '' },
      spy, cacheDir,
    )
    expect(params().postalcode).toBe('M1')
  })

  it('falls back to the state when no city is set', async () => {
    await areaFromLocation(
      { country: 'United States', state: 'Florida', city: '', zip: null, label: '' },
      spy, cacheDir,
    )
    expect(params()).toMatchObject({ state: 'Florida', country: 'United States' })
    expect(params().city).toBeUndefined()
  })

  it('caches per distinct location, not per country', async () => {
    let calls = 0
    const counting = async (url: string) => { seenUrl = url; calls++; return LONDON_RESPONSE }
    const base = { country: 'United States', state: 'Florida', zip: null, label: '' }
    await areaFromLocation({ ...base, city: 'Miami' }, counting, cacheDir)
    await areaFromLocation({ ...base, city: 'Orlando' }, counting, cacheDir)
    expect(calls).toBe(2)
  })
})
