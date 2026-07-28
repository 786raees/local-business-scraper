import { describe, it, expect, vi } from 'vitest'
import { exportToSheet, MAX_EXPORT_ROWS } from '../../src/sheets/exporter.js'
import { TEMPLATE_HEADERS } from '../../src/sheets/sheetTemplate.js'
import { Business } from '../../src/types.js'

const business = (i: number, over: Partial<Business> = {}): Business => ({
  placeId: `p${i}`, name: `Biz ${i}`, address: `${i} Main St`, phone: `+1 305-000-000${i}`,
  website: '', rating: null, reviewCount: null, priceLevel: '', category: 'Plumber',
  hours: '', email: '', mapsUrl: `https://maps/x/data=!19sPLACE${i}`, keyword: 'plumber',
  location: 'Miami', facebook: '', instagram: '', twitter: '', linkedin: '', youtube: '',
  tiktok: '', yelp: '', yellowpages: '', ownerName: '', ownerTitle: '', ownerSource: '', ...over,
})

function fakeClient(over: Record<string, unknown> = {}) {
  return {
    getTabs: vi.fn(async () => [{ sheetId: 5, title: 'Faizan', rowCount: 1000 }]),
    getValues: vi.fn(async () => [TEMPLATE_HEADERS]),
    appendValues: vi.fn(async () => undefined),
    updateValues: vi.fn(async () => undefined),
    clearValues: vi.fn(async () => undefined),
    batchUpdate: vi.fn(async () => ({ replies: [{ addSheet: { properties: { sheetId: 99 } } }] })),
    ...over,
  }
}

function deps(rows: Business[], client = fakeClient()) {
  return {
    client: client as never,
    count: () => rows.length,
    iterate: function* (batch: number) {
      for (let i = 0; i < rows.length; i += batch) yield rows.slice(i, i + batch)
    },
  }
}

describe('exportToSheet', () => {
  it('appends every row when the tab is empty of data', async () => {
    const client = fakeClient()
    const result = await exportToSheet(deps([business(1), business(2)], client),
      { spreadsheetId: 'sid', sheetTitle: 'Faizan' })
    expect(result).toEqual({ appended: 2, skipped: 0, total: 2 })
    expect(client.appendValues).toHaveBeenCalledTimes(1)
  })

  it('skips businesses whose placeId is already in the sheet', async () => {
    const mapsUrlCol = TEMPLATE_HEADERS.indexOf('mapsUrl')
    const existing = new Array(TEMPLATE_HEADERS.length).fill('')
    existing[mapsUrlCol] = 'https://maps/y/data=!19sPLACE1'
    const client = fakeClient({ getValues: vi.fn(async () => [TEMPLATE_HEADERS, existing]) })
    const result = await exportToSheet(deps([business(1), business(2)], client),
      { spreadsheetId: 'sid', sheetTitle: 'Faizan' })
    expect(result).toEqual({ appended: 1, skipped: 1, total: 2 })
  })

  it('writes rows at the header width', async () => {
    const client = fakeClient()
    await exportToSheet(deps([business(1)], client), { spreadsheetId: 'sid', sheetTitle: 'Faizan' })
    const values = client.appendValues.mock.calls[0][2]
    expect((values as string[][])[0]).toHaveLength(TEMPLATE_HEADERS.length)
  })

  it('never appends when every row is a duplicate', async () => {
    const mapsUrlCol = TEMPLATE_HEADERS.indexOf('mapsUrl')
    const existing = new Array(TEMPLATE_HEADERS.length).fill('')
    existing[mapsUrlCol] = 'https://maps/y/data=!19sPLACE1'
    const client = fakeClient({ getValues: vi.fn(async () => [TEMPLATE_HEADERS, existing]) })
    const result = await exportToSheet(deps([business(1)], client),
      { spreadsheetId: 'sid', sheetTitle: 'Faizan' })
    expect(result).toEqual({ appended: 0, skipped: 1, total: 1 })
    expect(client.appendValues).not.toHaveBeenCalled()
  })

  it('rejects before writing anything when over the row cap', async () => {
    const client = fakeClient()
    const d = { ...deps([business(1)], client), count: () => MAX_EXPORT_ROWS + 1 }
    await expect(exportToSheet(d, { spreadsheetId: 'sid', sheetTitle: 'Faizan' }))
      .rejects.toMatchObject({ status: 413 })
    expect(client.appendValues).not.toHaveBeenCalled()
  })

  it('builds the full template when the target tab is entirely empty', async () => {
    const client = fakeClient({ getValues: vi.fn(async () => []) })
    await exportToSheet(deps([business(1)], client), { spreadsheetId: 'sid', sheetTitle: 'Faizan' })
    expect(client.batchUpdate).toHaveBeenCalled()
    const ranges = client.updateValues.mock.calls.map((c) => c[1])
    expect(ranges.some((r) => String(r).includes('A1'))).toBe(true)
    expect(ranges.some((r) => String(r).includes('H2'))).toBe(true)
  })

  it('creates a new tab when asked', async () => {
    const client = fakeClient({ getTabs: vi.fn(async () => []), getValues: vi.fn(async () => []) })
    await exportToSheet(deps([business(1)], client),
      { spreadsheetId: 'sid', sheetTitle: 'Bilal', createNew: true })
    const addSheetCall = client.batchUpdate.mock.calls
      .flatMap((c) => c[1] as Record<string, any>[])
      .find((r) => r.addSheet)
    expect(addSheetCall.addSheet.properties.title).toBe('Bilal')
  })

  it('fails clearly when the tab does not exist and createNew is not set', async () => {
    const client = fakeClient({ getTabs: vi.fn(async () => []) })
    await expect(exportToSheet(deps([business(1)], client),
      { spreadsheetId: 'sid', sheetTitle: 'Nope' })).rejects.toThrow(/not found/i)
  })

  it('installs the Outreach ARRAYFORMULA after appending, not before', async () => {
    const client = fakeClient()
    const order: string[] = []
    client.appendValues = vi.fn(async () => { order.push('append'); return undefined }) as never
    client.updateValues = vi.fn(async (_id: string, range: string) => {
      order.push(`update:${range}`); return undefined
    }) as never
    await exportToSheet(deps([business(1)], client), { spreadsheetId: 'sid', sheetTitle: 'Faizan' })
    const lastUpdate = order.lastIndexOf(order.filter((o) => o.includes('H2')).pop() ?? '')
    expect(order.filter((o) => o.includes('H2'))).toHaveLength(1)
    expect(lastUpdate).toBeGreaterThan(order.indexOf('append'))
  })

  it('reinstalls the formula even on an already-formatted tab', async () => {
    const client = fakeClient()
    await exportToSheet(deps([business(1)], client), { spreadsheetId: 'sid', sheetTitle: 'Faizan' })
    const ranges = client.updateValues.mock.calls.map((c) => String(c[1]))
    expect(ranges.some((r) => r.includes('H2'))).toBe(true)
  })

  it('clears the Outreach column before writing the formula so it can expand', async () => {
    const client = fakeClient()
    await exportToSheet(deps([business(1)], client), { spreadsheetId: 'sid', sheetTitle: 'Faizan' })
    expect(client.clearValues).toHaveBeenCalledWith('sid', "'Faizan'!H2:H")
  })

  it('skips the formula when the tab has no Outreach column', async () => {
    const client = fakeClient({ getValues: vi.fn(async () => [['name', 'address', 'mapsUrl']]) })
    await exportToSheet(deps([business(1)], client), { spreadsheetId: 'sid', sheetTitle: 'Faizan' })
    expect(client.updateValues).not.toHaveBeenCalled()
  })

  it('batches large exports into multiple append calls', async () => {
    const client = fakeClient()
    const rows = Array.from({ length: 12000 }, (_, i) => business(i))
    const result = await exportToSheet(deps(rows, client), { spreadsheetId: 'sid', sheetTitle: 'Faizan' })
    expect(result.appended).toBe(12000)
    expect(client.appendValues).toHaveBeenCalledTimes(3) // 5000 + 5000 + 2000
  })
})
