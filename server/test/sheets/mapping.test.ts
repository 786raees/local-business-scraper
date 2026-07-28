import { describe, it, expect } from 'vitest'
import { buildHeaderMap, businessToRow, columnLetter } from '../../src/sheets/mapping.js'
import { TEMPLATE_HEADERS } from '../../src/sheets/sheetTemplate.js'
import { Business } from '../../src/types.js'

const business = (over: Partial<Business> = {}): Business => ({
  placeId: 'p1', name: 'The Plumbers', address: '4637 SW 75th Ave', phone: '+1 305-697-3490',
  website: 'https://x.com', rating: 4.9, reviewCount: 86, priceLevel: '', category: 'Plumber',
  hours: 'Open 24 hours', email: '', mapsUrl: 'https://maps/!19sABC', keyword: 'plumber',
  location: 'Miami', facebook: 'https://facebook.com/theplumbers', instagram: '', twitter: '',
  linkedin: 'https://linkedin.com/co', youtube: '', tiktok: '', yelp: '', yellowpages: '',
  ownerName: '', ownerTitle: '', ownerSource: '', ...over,
})

describe('columnLetter', () => {
  it('maps single-letter columns', () => {
    expect(columnLetter(0)).toBe('A')
    expect(columnLetter(25)).toBe('Z')
  })
  it('maps double-letter columns', () => {
    expect(columnLetter(26)).toBe('AA')
    expect(columnLetter(32)).toBe('AG')
  })
})

describe('buildHeaderMap', () => {
  it('maps Atlas headers to their column index', () => {
    const map = buildHeaderMap(['name', 'address', 'phone'])
    expect(map.fields).toEqual(['name', 'address', 'phone'])
    expect(map.width).toBe(3)
  })

  it('is case-insensitive and ignores surrounding whitespace', () => {
    expect(buildHeaderMap(['  NAME ', 'Address']).fields).toEqual(['name', 'address'])
  })

  it('leaves CRM columns unmapped', () => {
    const map = buildHeaderMap(['name', 'Stage', 'Notes', 'address'])
    expect(map.fields).toEqual(['name', null, null, 'address'])
  })

  it('never maps FB Status onto the facebook URL field', () => {
    const map = buildHeaderMap(['name', 'FB Status', 'facebook'])
    expect(map.fields).toEqual(['name', null, 'facebook'])
  })

  it('leaves unknown headers unmapped', () => {
    expect(buildHeaderMap(['name', 'Whatever']).fields).toEqual(['name', null])
  })

  it('records the index of the columns the exporter needs', () => {
    const map = buildHeaderMap(TEMPLATE_HEADERS)
    expect(map.stageIndex).toBe(1)
    expect(map.outreachIndex).toBe(7)
    expect(map.nameIndex).toBe(0)
    expect(TEMPLATE_HEADERS[map.mapsUrlIndex]).toBe('mapsUrl')
  })

  it('reports -1 when an expected column is absent', () => {
    const map = buildHeaderMap(['name', 'address'])
    expect(map.stageIndex).toBe(-1)
    expect(map.mapsUrlIndex).toBe(-1)
  })
})

describe('businessToRow', () => {
  it('produces a row exactly as wide as the header', () => {
    const map = buildHeaderMap(TEMPLATE_HEADERS)
    expect(businessToRow(business(), map)).toHaveLength(TEMPLATE_HEADERS.length)
  })

  it('places values in the mapped positions', () => {
    const map = buildHeaderMap(['name', 'phone', 'address'])
    expect(businessToRow(business(), map))
      .toEqual(['The Plumbers', '+1 305-697-3490', '4637 SW 75th Ave'])
  })

  it('seeds Stage to New', () => {
    const map = buildHeaderMap(TEMPLATE_HEADERS)
    expect(businessToRow(business(), map)[map.stageIndex]).toBe('New')
  })

  it('writes empty into the Outreach column so the ARRAYFORMULA survives', () => {
    const map = buildHeaderMap(TEMPLATE_HEADERS)
    expect(businessToRow(business(), map)[map.outreachIndex]).toBe('')
  })

  it('leaves other CRM columns blank', () => {
    const map = buildHeaderMap(['name', 'Priority', 'Notes'])
    expect(businessToRow(business(), map)).toEqual(['The Plumbers', '', ''])
  })

  it('puts the facebook URL in the facebook column, not FB Status', () => {
    const map = buildHeaderMap(['FB Status', 'facebook'])
    expect(businessToRow(business(), map)).toEqual(['', 'https://facebook.com/theplumbers'])
  })

  it('renders null numerics as empty strings', () => {
    const map = buildHeaderMap(['rating', 'reviewCount'])
    expect(businessToRow(business({ rating: null, reviewCount: null }), map)).toEqual(['', ''])
  })

  it('stringifies numbers', () => {
    const map = buildHeaderMap(['rating'])
    expect(businessToRow(business({ rating: 4.9 }), map)).toEqual(['4.9'])
  })

  it('strips icon glyphs defensively', () => {
    const map = buildHeaderMap(['address'])
    expect(businessToRow(business({ address: '\ue0c8 4637 SW 75th Ave' }), map))
      .toEqual(['4637 SW 75th Ave'])
  })
})
