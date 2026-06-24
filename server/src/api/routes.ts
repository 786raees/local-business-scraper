import express, { Express } from 'express'
import { toCsv } from '../export/csv.js'
import { Business, JobSettings, LocationSpec } from '../types.js'

export interface RouteDeps {
  geo: {
    countries: () => { code: string; name: string }[]
    states: (country: string) => { code: string; name: string }[]
    cities: (country: string, state: string) => { name: string }[]
    zips: (country: string, state: string, city: string) => Promise<string[]>
  }
  startJob: (keywords: string[], locations: LocationSpec[], settings: JobSettings) => void
  stopJob: () => void
}

export function createApp(deps: RouteDeps): Express {
  const app = express()
  app.use(express.json({ limit: '10mb' }))

  app.get('/api/geo/countries', (_req, res) => res.json(deps.geo.countries()))
  app.get('/api/geo/states', (req, res) => res.json(deps.geo.states(String(req.query.country ?? ''))))
  app.get('/api/geo/cities', (req, res) =>
    res.json(deps.geo.cities(String(req.query.country ?? ''), String(req.query.state ?? ''))))
  app.get('/api/geo/zips', async (req, res) => {
    const zips = await deps.geo.zips(
      String(req.query.country ?? ''), String(req.query.state ?? ''), String(req.query.city ?? ''))
    res.json(zips)
  })

  app.post('/api/job/start', (req, res) => {
    const { keywords, locations, settings } = req.body
    deps.startJob(keywords, locations, settings)
    res.json({ ok: true })
  })
  app.post('/api/job/stop', (_req, res) => { deps.stopJob(); res.json({ ok: true }) })

  app.post('/api/export/csv', (req, res) => {
    const rows: Business[] = req.body.rows ?? []
    const columns = req.body.columns as (keyof Business)[] | undefined
    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', 'attachment; filename="results.csv"')
    res.send(toCsv(rows, columns))
  })

  return app
}
