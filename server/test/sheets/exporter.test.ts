import { describe, it, expect, vi } from 'vitest'
import { exportToSheet, exportSplit, splitQuotas, MAX_EXPORT_ROWS } from '../../src/sheets/exporter.js'
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
    conditionalFormatCount: vi.fn(async () => 14),
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

  it('deletes stale conditional-format rules before applying the template', async () => {
    const client = fakeClient({ getValues: vi.fn(async () => []) })
    await exportToSheet(deps([business(1)], client), { spreadsheetId: 'sid', sheetTitle: 'Faizan' })
    const reqs = client.batchUpdate.mock.calls.flatMap((c) => c[1] as Record<string, any>[])
    const deletes = reqs.filter((r) => r.deleteConditionalFormatRule)
    expect(deletes).toHaveLength(14)
    // every delete must precede the first added rule
    const firstAdd = reqs.findIndex((r) => r.addConditionalFormatRule)
    const lastDelete = reqs.map((r) => !!r.deleteConditionalFormatRule).lastIndexOf(true)
    expect(lastDelete).toBeLessThan(firstAdd)
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

  it('writes the Outreach formula with USER_ENTERED and everything else RAW', async () => {
    const client = fakeClient({ getValues: vi.fn(async () => []) })
    await exportToSheet(deps([business(1)], client), { spreadsheetId: 'sid', sheetTitle: 'Faizan' })
    for (const call of client.updateValues.mock.calls) {
      const [, range, , mode] = call as unknown as [string, string, string[][], string | undefined]
      // Only the formula install may use USER_ENTERED.
      if (String(range).includes('H2')) expect(mode).toBe('USER_ENTERED')
      else expect(mode).toBeUndefined() // defaults to RAW
    }
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

describe('splitQuotas', () => {
  it('splits exactly on round numbers', () => {
    expect(splitQuotas(100, [50, 40, 10])).toEqual([50, 40, 10])
  })
  it('gives remainder rows to the first target', () => {
    expect(splitQuotas(10, [33, 33, 34])).toEqual([3 + 1, 3, 3]) // floors 3,3,3 + 1 remainder
  })
  it('handles a zero-rounding target', () => {
    expect(splitQuotas(5, [90, 10])).toEqual([5, 0])
  })
  it('single target takes everything', () => {
    expect(splitQuotas(7, [100])).toEqual([7])
  })
})

describe('exportSplit', () => {
  it('routes sequential blocks to each target', async () => {
    const client = fakeClient({
      getTabs: vi.fn(async () => [
        { sheetId: 5, title: 'Faizan', rowCount: 1000 },
        { sheetId: 6, title: 'Amna', rowCount: 1000 },
      ]),
    })
    const rows = Array.from({ length: 10 }, (_, i) => business(i))
    const res = await exportSplit(deps(rows, client), {
      spreadsheetId: 'sid',
      targets: [
        { sheetTitle: 'Faizan', percent: 50 },
        { sheetTitle: 'Amna', percent: 50 },
      ],
    })
    expect(res.total).toBe(10)
    expect(res.perTab).toEqual([
      { sheetTitle: 'Faizan', appended: 5, skipped: 0 },
      { sheetTitle: 'Amna', appended: 5, skipped: 0 },
    ])
    // first append call went to Faizan with rows 0-4, second to Amna with rows 5-9
    const calls = client.appendValues.mock.calls
    expect(String(calls[0][1])).toContain('Faizan')
    expect((calls[0][2] as string[][])[0][0]).toBe('Biz 0')
    expect(String(calls[1][1])).toContain('Amna')
    expect((calls[1][2] as string[][])[0][0]).toBe('Biz 5')
  })

  it('filters by placeIds when provided', async () => {
    const client = fakeClient()
    const rows = Array.from({ length: 10 }, (_, i) => business(i))
    const res = await exportSplit(deps(rows, client), {
      spreadsheetId: 'sid',
      targets: [{ sheetTitle: 'Faizan', percent: 100 }],
      placeIds: ['p2', 'p5', 'p7'],
    })
    expect(res.total).toBe(3)
    expect(res.perTab[0].appended).toBe(3)
    const values = client.appendValues.mock.calls[0][2] as string[][]
    expect(values.map((v) => v[0])).toEqual(['Biz 2', 'Biz 5', 'Biz 7'])
  })

  it('rejects percentages not totalling 100', async () => {
    await expect(exportSplit(deps([business(1)], fakeClient()), {
      spreadsheetId: 'sid', targets: [{ sheetTitle: 'Faizan', percent: 60 }],
    })).rejects.toMatchObject({ status: 400 })
  })

  it('checks the row cap against the selection size, not the whole store', async () => {
    const client = fakeClient()
    const d = { ...deps([business(1)], client), count: () => MAX_EXPORT_ROWS + 500 }
    // selection of 1 must pass even though the store holds more than the cap
    const res = await exportSplit(d, {
      spreadsheetId: 'sid', targets: [{ sheetTitle: 'Faizan', percent: 100 }], placeIds: ['p1'],
    })
    expect(res.total).toBe(1)
  })

  it('still creates a zero-quota new tab', async () => {
    const client = fakeClient({
      getTabs: vi.fn(async () => [{ sheetId: 5, title: 'Faizan', rowCount: 1000 }]),
      getValues: vi.fn(async (_id: string, range: string) =>
        String(range).includes('Bilal') ? [] : [TEMPLATE_HEADERS]),
    })
    const res = await exportSplit(deps(Array.from({ length: 3 }, (_, i) => business(i)), client), {
      spreadsheetId: 'sid',
      targets: [
        { sheetTitle: 'Faizan', percent: 100 },
        { sheetTitle: 'Bilal', percent: 0, createNew: true },
      ],
    })
    expect(res.perTab).toEqual([
      { sheetTitle: 'Faizan', appended: 3, skipped: 0 },
      { sheetTitle: 'Bilal', appended: 0, skipped: 0 },
    ])
    const addSheet = client.batchUpdate.mock.calls
      .flatMap((c) => c[1] as Record<string, any>[]).find((r) => r.addSheet)
    expect(addSheet.addSheet.properties.title).toBe('Bilal')
  })
})
