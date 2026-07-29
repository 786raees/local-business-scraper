import { describe, expect, it } from 'vitest'
import { buildMapping, columnLetter, rowToLead, validateTab } from '../src/sheets/mapping'

/** The canonical Atlas template header order (sheetTemplate.ts TEMPLATE_HEADERS). */
const TEMPLATE = [
  'name', 'Stage', 'Call Status', 'SMS Status', 'FB Status', 'IG Status', 'LI Status',
  'Outreach', 'Priority', 'Notes', 'ownerName', 'ownerTitle', 'address', 'phone', 'website',
  'email', 'rating', 'reviewCount', 'priceLevel', 'category', 'hours', 'facebook', 'instagram',
  'twitter', 'linkedin', 'youtube', 'tiktok', 'yelp', 'yellowpages', 'ownerSource', 'mapsUrl',
  'keyword', 'location',
]

describe('validateTab', () => {
  it('accepts the canonical Atlas template', () => {
    expect(validateTab(TEMPLATE)).toEqual({ ok: true, missing: [] })
  })

  it('reports missing headers by name', () => {
    expect(validateTab(['name', 'phone', 'Notes'])).toEqual({ ok: false, missing: ['Call Status'] })
    expect(validateTab(['foo'])).toEqual({ ok: false, missing: ['name', 'phone', 'Call Status'] })
  })

  it('matches case-insensitively', () => {
    expect(validateTab(['NAME', 'Phone', 'call STATUS']).ok).toBe(true)
  })
})

describe('buildMapping', () => {
  it('resolves by header name on the canonical template', () => {
    const m = buildMapping(TEMPLATE)
    expect(m.nameCol).toBe(0)
    expect(m.callStatusCol).toBe(2)
    expect(m.phoneCol).toBe(13)
    expect(m.notesCol).toBe(9)
    expect(m.width).toBe(33)
  })

  it('survives reordered and inserted columns', () => {
    const m = buildMapping(['My CRM Id', 'phone', 'Call Status', 'name', 'Notes'])
    expect(m.nameCol).toBe(3)
    expect(m.phoneCol).toBe(1)
    expect(m.callStatusCol).toBe(2)
    expect(m.notesCol).toBe(4)
  })

  it('throws with the missing list on an invalid tab', () => {
    expect(() => buildMapping(['name', 'phone']))
      .toThrow('missing required headers: Call Status')
  })
})

describe('columnLetter', () => {
  it('handles A..Z and beyond (33-column Atlas tabs)', () => {
    expect(columnLetter(0)).toBe('A')
    expect(columnLetter(2)).toBe('C')
    expect(columnLetter(25)).toBe('Z')
    expect(columnLetter(26)).toBe('AA')
    expect(columnLetter(32)).toBe('AG')
    expect(columnLetter(51)).toBe('AZ')
    expect(columnLetter(52)).toBe('BA')
  })
})

describe('rowToLead', () => {
  const mapping = buildMapping(TEMPLATE)

  it('maps required + optional fields with rowIndex as identity', () => {
    const row = Array.from({ length: 33 }, () => '')
    row[0] = 'Big Sky Dental'
    row[1] = 'Contacted'
    row[2] = 'No Answer'
    row[9] = 'left VM last week'
    row[10] = 'Dana Roe'
    row[13] = '+1 305-697-3490'
    row[16] = '4.6'
    row[17] = '212'

    const lead = rowToLead(row, 42, mapping)
    expect(lead).toMatchObject({
      rowIndex: 42,
      name: 'Big Sky Dental',
      phone: '+1 305-697-3490',
      stage: 'Contacted',
      callStatus: 'No Answer',
      notes: 'left VM last week',
      ownerName: 'Dana Roe',
      rating: '4.6',
      reviewCount: '212',
    })
  })

  it('leaves absent/blank cells undefined and tolerates short rows', () => {
    const lead = rowToLead(['Acme', '', 'Answered'], 2, mapping)
    expect(lead.name).toBe('Acme')
    expect(lead.phone).toBe('')
    expect(lead.ownerName).toBeUndefined()
    expect(lead.notes).toBeUndefined()
  })

  it('picks up lineType/lineCarrier when the headers exist (story 13)', () => {
    const m = buildMapping(['name', 'phone', 'Call Status', 'lineType', 'lineCarrier'])
    const lead = rowToLead(['Acme', '+1', '', 'mobile', 'Verizon Wireless'], 2, m)
    expect(lead.lineType).toBe('mobile')
    expect(lead.lineCarrier).toBe('Verizon Wireless')
  })

  it('tabs without the line headers behave exactly as before', () => {
    // TEMPLATE predates the feature: mapping succeeds, fields stay undefined,
    // and validateTab never requires them.
    const lead = rowToLead(['Acme'], 2, mapping)
    expect(lead.lineType).toBeUndefined()
    expect(lead.lineCarrier).toBeUndefined()
    expect(validateTab(['name', 'phone', 'Call Status']).ok).toBe(true)
  })
})
