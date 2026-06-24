import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/api/routes.js'

const deps = {
  geo: {
    countries: () => [{ code: 'US', name: 'United States' }],
    states: () => [{ code: 'FL', name: 'Florida' }],
    cities: () => [{ name: 'Miami' }],
    zips: async () => ['33101', '33102'],
  },
  startJob: () => {}, stopJob: () => {},
}

describe('routes', () => {
  it('GET /api/geo/countries returns list', async () => {
    const res = await request(createApp(deps as any)).get('/api/geo/countries')
    expect(res.status).toBe(200)
    expect(res.body[0].code).toBe('US')
  })
  it('POST /api/export/csv returns csv attachment', async () => {
    const res = await request(createApp(deps as any))
      .post('/api/export/csv')
      .send({ rows: [], columns: ['name'] })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
  })
})
