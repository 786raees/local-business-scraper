import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { listCountries, listStates, listCities } from '../src/geo/geoData.js'
import { lookupZips } from '../src/geo/zipLookup.js'

describe('geoData', () => {
  it('lists countries including US', () => {
    expect(listCountries().some((c) => c.code === 'US')).toBe(true)
  })
  it('lists US states including Florida', () => {
    expect(listStates('US').some((s) => s.name === 'Florida')).toBe(true)
  })

  // country-state-city maps every GB city onto just 4 of its 247 subdivisions, so an
  // unfiltered state list leaves the City dropdown empty for 243 of them.
  it('only lists states that actually have cities', () => {
    for (const s of listStates('GB')) {
      expect(listCities('GB', s.code), `${s.code} ${s.name}`).not.toHaveLength(0)
    }
  })

  it('keeps all 50 US states plus DC and Puerto Rico', () => {
    const names = new Set(listStates('US').map((s) => s.name))
    for (const n of ['Alaska', 'Florida', 'Hawaii', 'Wyoming', 'District of Columbia', 'Puerto Rico']) {
      expect(names, n).toContain(n)
    }
    // 50 states + DC + PR; the 14 dropped entries are uninhabited atolls with no city data.
    expect(names.size).toBe(52)
  })

  it('renames the GB subdivision whose cities are really Northern Ireland', () => {
    const nyk = listStates('GB').find((s) => s.code === 'NYK')
    expect(nyk?.name).toBe('Northern Ireland')
  })

  it('falls back to the full list when no state has cities', () => {
    // Vatican City has one subdivision-less entry set; never strip a country down to nothing.
    for (const cc of ['VA', 'MC', 'SG']) {
      const states = listStates(cc)
      if (states.length === 0) continue
      expect(states.length).toBeGreaterThan(0)
    }
  })
})

describe('lookupZips', () => {
  it('parses zips from injected zippopotam-style json', async () => {
    const fake = async () => ({ places: [{ 'post code': '33101' }, { 'post code': '33102' }] })
    const zips = await lookupZips('US', 'Florida', 'Miami', fake)
    expect(zips).toContain('33101')
  })
  it('returns empty array on fetch error', async () => {
    const boom = async () => { throw new Error('net') }
    expect(await lookupZips('US', 'Florida', 'Nowhere', boom)).toEqual([])
  })

  // country-state-city lists administrative areas alongside real cities ("Greater London",
  // "Aberdeen City"). Zippopotam only knows the bare place name, so those 404 as-is.
  describe('administrative-area names', () => {
    // The on-disk cache is shared global state: without an isolated dir these tests would
    // read each other's fixtures and pollute the real server/.geo-cache.
    let cacheDir: string
    beforeEach(async () => { cacheDir = await mkdtemp(join(tmpdir(), 'ziptest-')) })
    afterEach(async () => { await rm(cacheDir, { recursive: true, force: true }) })

    // Serves results only for the bare name, mimicking Zippopotam.
    const onlyBare = (bare: string) => async (url: string) => {
      if (!url.toLowerCase().endsWith(`/${bare.toLowerCase()}`)) throw new Error('HTTP 404')
      return { places: [{ 'post code': 'OK1' }] }
    }

    it('falls back to the bare name for "Greater X"', async () => {
      expect(await lookupZips('GB', 'ENG', 'Greater London', onlyBare('london'), cacheDir)).toEqual(['OK1'])
    })

    it('falls back to the bare name for "X City"', async () => {
      expect(await lookupZips('GB', 'SCT', 'Aberdeen City', onlyBare('aberdeen'), cacheDir)).toEqual(['OK1'])
    })

    it('falls back to the bare name for "City of X"', async () => {
      expect(await lookupZips('GB', 'ENG', 'City of Westminster', onlyBare('westminster'), cacheDir)).toEqual(['OK1'])
    })

    it('prefers the exact name over the fallback', async () => {
      const tried: string[] = []
      const fetchJson = async (url: string) => {
        tried.push(url)
        return { places: [{ 'post code': 'EXACT' }] }
      }
      expect(await lookupZips('GB', 'ENG', 'Greater London', fetchJson, cacheDir)).toEqual(['EXACT'])
      expect(tried).toHaveLength(1)
    })
  })
})
