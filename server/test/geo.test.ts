import { describe, it, expect } from 'vitest'
import { listCountries, listStates } from '../src/geo/geoData.js'
import { lookupZips } from '../src/geo/zipLookup.js'

describe('geoData', () => {
  it('lists countries including US', () => {
    expect(listCountries().some((c) => c.code === 'US')).toBe(true)
  })
  it('lists US states including Florida', () => {
    expect(listStates('US').some((s) => s.name === 'Florida')).toBe(true)
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
})
