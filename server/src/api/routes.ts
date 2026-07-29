import express, { Express } from 'express'
import { Request } from 'express'
import { csvHeaderLine, csvRows } from '../export/csv.js'
import {
  Business, JobSettings, LocationSpec, ResultQuery,
  SpreadsheetRef, TabRef, ExportTarget, SplitExportResult, normalizeSettings,
} from '../types.js'

const LINE_TYPES = new Set(['mobile', 'landline', 'voip', 'unknown'])

function parseQuery(req: Request): ResultQuery {
  const q = req.query
  const num = (v: unknown) => (v != null && v !== '' ? Number(v) : undefined)
  const bool = (v: unknown) => v === '1' || v === 'true'
  return {
    q: q.q ? String(q.q) : '',
    category: q.category ? String(q.category) : '',
    minRating: num(q.minRating),
    minReviews: num(q.minReviews),
    hasEmail: bool(q.hasEmail),
    hasWebsite: bool(q.hasWebsite),
    hasPhone: bool(q.hasPhone),
    // Unrecognized values simply mean "no filter", like the other params.
    lineType: LINE_TYPES.has(String(q.lineType)) ? String(q.lineType) : undefined,
    sortBy: q.sortBy ? String(q.sortBy) : undefined,
    sortDir: q.sortDir === 'desc' ? 'desc' : 'asc',
  }
}

export interface RouteDeps {
  geo: {
    countries: () => { code: string; name: string }[]
    states: (country: string) => { code: string; name: string }[]
    cities: (country: string, state: string) => { name: string }[]
    zips: (country: string, state: string, city: string) => Promise<string[]>
  }
  results: {
    page: (offset: number, limit: number, query: ResultQuery) => Business[]
    count: (query: ResultQuery) => number
    ids: (offset: number, limit: number, query: ResultQuery) => string[]
    iterate: (batch: number, query?: ResultQuery) => Generator<Business[]>
    clear: () => void
  }
  startJob: (keywords: string[], locations: LocationSpec[], settings: JobSettings) => void
  stopJob: () => void
  sheets: {
    configured: () => boolean
    clientEmail: () => string
    listSpreadsheets: () => Promise<SpreadsheetRef[]>
    listTabs: (spreadsheetId: string) => Promise<TabRef[]>
    exportTo: (spreadsheetId: string, targets: ExportTarget[], placeIds?: string[]) => Promise<SplitExportResult>
  }
}

export function createApp(deps: RouteDeps): Express {
  const app = express()
  app.use(express.json({ limit: '2mb' }))

  app.get('/api/geo/countries', (_req, res) => res.json(deps.geo.countries()))
  app.get('/api/geo/states', (req, res) => res.json(deps.geo.states(String(req.query.country ?? ''))))
  app.get('/api/geo/cities', (req, res) =>
    res.json(deps.geo.cities(String(req.query.country ?? ''), String(req.query.state ?? ''))))
  app.get('/api/geo/zips', async (req, res) => {
    const zips = await deps.geo.zips(
      String(req.query.country ?? ''), String(req.query.state ?? ''), String(req.query.city ?? ''))
    res.json(zips)
  })

  // Paginated, filtered window over results — the FE fetches only what it shows.
  app.get('/api/results', (req, res) => {
    const offset = Math.max(0, Number(req.query.offset ?? 0))
    const limit = Math.min(500, Math.max(1, Number(req.query.limit ?? 100)))
    const query = parseQuery(req)
    res.json({ rows: deps.results.page(offset, limit, query), total: deps.results.count(query) })
  })

  // placeIds in display order for the current filter/sort — powers shift-range selection.
  app.get('/api/results/ids', (req, res) => {
    const offset = Math.max(0, Number(req.query.offset ?? 0))
    const limit = Math.min(50000, Math.max(1, Number(req.query.limit ?? 1000)))
    res.json(deps.results.ids(offset, limit, parseQuery(req)))
  })

  app.post('/api/job/start', (req, res) => {
    const { keywords, locations, settings } = req.body ?? {}
    const kw = (Array.isArray(keywords) ? keywords : []).map(String).filter((k) => k.trim())
    const locs = (Array.isArray(locations) ? locations : []) as LocationSpec[]
    if (!kw.length || !locs.length) {
      return res.status(400).json({ error: 'keywords and locations are both required' })
    }
    deps.startJob(kw, locs, normalizeSettings(settings ?? {}))
    res.json({ ok: true })
  })
  app.post('/api/job/stop', (_req, res) => { deps.stopJob(); res.json({ ok: true }) })

  // Wipe all stored results (e.g. after exporting CSV).
  app.post('/api/results/clear', (_req, res) => { deps.results.clear(); res.json({ ok: true }) })

  // Stream the (optionally filtered) result set from disk so export scales to
  // millions of rows. The same query params as /api/results apply, so "export
  // what I'm looking at" is one link.
  app.get('/api/export/csv', (req, res) => {
    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', 'attachment; filename="results.csv"')
    res.write(csvHeaderLine() + '\n')
    for (const batch of deps.results.iterate(1000, parseQuery(req))) res.write(csvRows(batch))
    res.end()
  })

  // --- Google Sheets export -------------------------------------------------
  // A 403 from Google almost always means "the sheet isn't shared with the
  // service account", so every failure path carries the address to share with.
  const sheetsError = (res: express.Response, e: unknown) => {
    const status = (e as { status?: number }).status ?? 500
    const error = e instanceof Error ? e.message : 'Google Sheets request failed'
    res.status(status).json({ error, shareWith: deps.sheets.clientEmail() })
  }

  const requireConfigured = (res: express.Response): boolean => {
    if (deps.sheets.configured()) return true
    res.status(503).json({ error: 'Google Sheets export is not configured on the server.' })
    return false
  }

  app.get('/api/sheets/spreadsheets', async (_req, res) => {
    if (!requireConfigured(res)) return
    try { res.json(await deps.sheets.listSpreadsheets()) } catch (e) { sheetsError(res, e) }
  })

  app.get('/api/sheets/:id/tabs', async (req, res) => {
    if (!requireConfigured(res)) return
    try { res.json(await deps.sheets.listTabs(String(req.params.id))) } catch (e) { sheetsError(res, e) }
  })

  app.post('/api/export/sheets', async (req, res) => {
    if (!requireConfigured(res)) return
    const { spreadsheetId, targets, placeIds } = req.body ?? {}
    if (!spreadsheetId || !Array.isArray(targets) || !targets.length) {
      return res.status(400).json({ error: 'spreadsheetId and at least one target are required' })
    }
    const parsed: ExportTarget[] = targets.map((t: Record<string, unknown>) => ({
      sheetTitle: String(t?.sheetTitle ?? ''),
      createNew: Boolean(t?.createNew),
      percent: Number(t?.percent),
    }))
    if (parsed.some((t) => !t.sheetTitle.trim() || !Number.isInteger(t.percent) || t.percent < 0)) {
      return res.status(400).json({ error: 'each target needs a sheetTitle and a non-negative integer percent' })
    }
    if (new Set(parsed.map((t) => t.sheetTitle)).size !== parsed.length) {
      return res.status(400).json({ error: 'target tabs must be distinct' })
    }
    const pctSum = parsed.reduce((a, t) => a + t.percent, 0)
    if (pctSum !== 100) {
      return res.status(400).json({ error: `target percentages sum to ${pctSum}, they must total exactly 100` })
    }
    const ids = Array.isArray(placeIds) ? placeIds.map(String) : undefined
    if (ids && ids.length > 50000) {
      return res.status(413).json({ error: 'selection exceeds the 50,000-row export limit' })
    }
    try {
      res.json(await deps.sheets.exportTo(String(spreadsheetId), parsed, ids))
    } catch (e) { sheetsError(res, e) }
  })

  return app
}
