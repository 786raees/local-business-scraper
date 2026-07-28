import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/api/routes.js'
import { emptyBusiness } from '../src/types.js'

function makeDeps() {
  const rows = [
    { ...emptyBusiness('plumber', 'Miami'), name: 'Acme' },
    { ...emptyBusiness('plumber', 'Miami'), name: 'Beta' },
  ]
  return {
    geo: {
      countries: () => [{ code: 'US', name: 'United States' }],
      states: () => [{ code: 'FL', name: 'Florida' }],
      cities: () => [{ name: 'Miami' }],
      zips: async () => ['33101', '33102'],
    },
    results: {
      page: (offset: number, limit: number) => rows.slice(offset, offset + limit),
      count: () => rows.length,
      *iterate() { yield rows },
      cleared: false,
      clear() { this.cleared = true },
    },
    startJob: () => {}, stopJob: () => {},
    sheets: {
      configured: () => true,
      clientEmail: () => 'svc@example.iam.gserviceaccount.com',
      listSpreadsheets: async () => [{ id: 'a', name: 'Plumber leads' }],
      listTabs: async () => [{ sheetId: 1, title: 'Faizan', rowCount: 51 }],
      exportTo: async () => ({ appended: 112, skipped: 38, total: 150 }),
    },
  }
}

describe('routes', () => {
  it('GET /api/geo/countries returns list', async () => {
    const res = await request(createApp(makeDeps() as any)).get('/api/geo/countries')
    expect(res.status).toBe(200)
    expect(res.body[0].code).toBe('US')
  })

  it('GET /api/results returns paginated rows + total', async () => {
    const res = await request(createApp(makeDeps() as any)).get('/api/results?offset=0&limit=1')
    expect(res.status).toBe(200)
    expect(res.body.total).toBe(2)
    expect(res.body.rows).toHaveLength(1)
    expect(res.body.rows[0].name).toBe('Acme')
  })

  it('POST /api/results/clear invokes clear', async () => {
    const deps = makeDeps()
    const res = await request(createApp(deps as any)).post('/api/results/clear')
    expect(res.status).toBe(200)
    expect((deps.results as any).cleared).toBe(true)
  })

  it('GET /api/export/csv streams a csv attachment with header + rows', async () => {
    const res = await request(createApp(makeDeps() as any)).get('/api/export/csv')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
    expect(res.text.split('\n')[0]).toContain('name,ownerName')
    expect(res.text).toContain('Acme')
    expect(res.text).toContain('Beta')
  })
})

describe('sheets routes', () => {
  it('lists spreadsheets', async () => {
    const res = await request(createApp(makeDeps() as any)).get('/api/sheets/spreadsheets')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([{ id: 'a', name: 'Plumber leads' }])
  })

  it('lists tabs for a spreadsheet', async () => {
    const res = await request(createApp(makeDeps() as any)).get('/api/sheets/abc/tabs')
    expect(res.status).toBe(200)
    expect(res.body[0].title).toBe('Faizan')
  })

  it('reports 503 when unconfigured', async () => {
    const deps = makeDeps()
    deps.sheets.configured = () => false
    const res = await request(createApp(deps as any)).get('/api/sheets/spreadsheets')
    expect(res.status).toBe(503)
    expect(res.body.error).toMatch(/not configured/i)
  })

  it('exports and returns the summary', async () => {
    const res = await request(createApp(makeDeps() as any))
      .post('/api/export/sheets')
      .send({ spreadsheetId: 'abc', sheetTitle: 'Faizan' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ appended: 112, skipped: 38, total: 150 })
  })

  it('rejects an export with no spreadsheetId', async () => {
    const res = await request(createApp(makeDeps() as any))
      .post('/api/export/sheets').send({ sheetTitle: 'Faizan' })
    expect(res.status).toBe(400)
  })

  it('surfaces the service-account address on a 403 from Google', async () => {
    const deps = makeDeps()
    deps.sheets.exportTo = async () => { throw Object.assign(new Error('denied'), { status: 403 }) }
    const res = await request(createApp(deps as any))
      .post('/api/export/sheets').send({ spreadsheetId: 'abc', sheetTitle: 'Faizan' })
    expect(res.status).toBe(403)
    expect(res.body.shareWith).toBe('svc@example.iam.gserviceaccount.com')
  })

  it('passes the row-cap status through', async () => {
    const deps = makeDeps()
    deps.sheets.exportTo = async () => { throw Object.assign(new Error('too many'), { status: 413 }) }
    const res = await request(createApp(deps as any))
      .post('/api/export/sheets').send({ spreadsheetId: 'abc', sheetTitle: 'Faizan' })
    expect(res.status).toBe(413)
  })
})
