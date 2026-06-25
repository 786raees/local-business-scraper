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
    },
    startJob: () => {}, stopJob: () => {},
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

  it('GET /api/export/csv streams a csv attachment with header + rows', async () => {
    const res = await request(createApp(makeDeps() as any)).get('/api/export/csv')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
    expect(res.text.split('\n')[0]).toContain('name,address')
    expect(res.text).toContain('Acme')
    expect(res.text).toContain('Beta')
  })
})
