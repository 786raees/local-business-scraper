import { createServer } from 'node:http'
import { createApp } from './api/routes.js'
import { WsHub } from './ws/hub.js'
import { listCountries, listStates, listCities } from './geo/geoData.js'
import { lookupZips } from './geo/zipLookup.js'
import { JobRunner } from './queue/jobRunner.js'
import { scrapeMaps } from './scraper/mapsScraper.js'
import { ResultsStore } from './db/store.js'
import { SheetsAuth } from './sheets/auth.js'
import { SheetsClient } from './sheets/client.js'
import { exportSplit } from './sheets/exporter.js'
import { JobSettings, LocationSpec, JobEvent, ExportTarget } from './types.js'

const store = new ResultsStore('results.db')

const sheetsAuth = new SheetsAuth()
const sheetsClient = new SheetsClient(sheetsAuth)

let hub: WsHub
// Website enrichment (email + socials) happens inside scrapeMaps using the browser.
// `viewport` must be forwarded — it is what confines a task to its grid tile.
// `() => inserted` is the job budget's meter: maxResults counts unique places stored,
// so duplicate sightings from overlapping tiles never consume it.
const runner = new JobRunner(
  (keyword, location, settings, onRow, signal, viewport) =>
    scrapeMaps(keyword, location, settings, onRow, signal, viewport),
  undefined,
  () => inserted,
)

// Persist rows to the DB and broadcast a throttled count instead of one
// message per row — so the browser never receives millions of WS messages.
let inserted = 0
let duplicates = 0
let lastCountAt = 0
function handleEvent(e: JobEvent): void {
  if (e.type === 'row') {
    // Adjacent grid tiles overlap by design, so the same place arrives repeatedly.
    // Only genuinely new places count — otherwise the UI total is meaningless.
    if (store.insert(e.business)) inserted++
    else duplicates++
    const now = Date.now()
    if (now - lastCountAt > 400) {
      lastCountAt = now
      hub.broadcast({ type: 'count', total: inserted, duplicates })
    }
    return
  }
  if (e.type === 'job-done') {
    hub.broadcast({ type: 'count', total: inserted, duplicates })
  }
  hub.broadcast(e)
}

const app = createApp({
  geo: {
    countries: listCountries,
    states: listStates,
    cities: listCities,
    zips: (c, s, city) => lookupZips(c, s, city),
  },
  results: {
    page: (offset, limit, filter) => store.queryPage(offset, limit, filter),
    count: (filter) => store.count(filter),
    ids: (offset, limit, filter) => store.queryIds(offset, limit, filter),
    iterate: (batch, filter) => store.iterateAll(batch, filter),
    clear: () => { store.reset(); inserted = 0; duplicates = 0 },
  },
  startJob: (keywords: string[], locations: LocationSpec[], settings: JobSettings) => {
    store.reset()
    inserted = 0
    duplicates = 0
    lastCountAt = 0
    runner.run(keywords, locations, settings, handleEvent)
  },
  stopJob: () => runner.stop(),
  sheets: {
    configured: () => sheetsAuth.isConfigured(),
    clientEmail: () => sheetsAuth.clientEmail(),
    listSpreadsheets: () => sheetsClient.listSpreadsheets(),
    listTabs: (id: string) => sheetsClient.getTabs(id),
    exportTo: (spreadsheetId: string, targets: ExportTarget[], placeIds?: string[]) =>
      exportSplit(
        { client: sheetsClient, iterate: (b) => store.iterateAll(b), count: () => store.count({}) },
        { spreadsheetId, targets, placeIds },
      ),
  },
})

const server = createServer(app)
hub = new WsHub(server)
const PORT = 5174
server.listen(PORT, () => console.log(`server on http://localhost:${PORT}`))
