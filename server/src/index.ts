import { createServer } from 'node:http'
import { createApp } from './api/routes.js'
import { WsHub } from './ws/hub.js'
import { listCountries, listStates, listCities } from './geo/geoData.js'
import { lookupZips } from './geo/zipLookup.js'
import { JobRunner } from './queue/jobRunner.js'
import { scrapeMaps } from './scraper/mapsScraper.js'
import { findEmailForWebsite } from './scraper/emailScraper.js'
import { ResultsStore } from './db/store.js'
import { JobSettings, LocationSpec, Business, JobEvent } from './types.js'

const store = new ResultsStore('results.db')

let hub: WsHub
const runner = new JobRunner(async (keyword, location, settings, onRow, signal) => {
  return scrapeMaps(keyword, location, settings, async (b: Business) => {
    if (settings.extractEmail && b.website) {
      b.email = await findEmailForWebsite(b.website, async (url) => {
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
        return res.text()
      })
    }
    onRow(b)
  }, signal)
})

// Persist rows to the DB and broadcast a throttled count instead of one
// message per row — so the browser never receives millions of WS messages.
let inserted = 0
let lastCountAt = 0
function handleEvent(e: JobEvent): void {
  if (e.type === 'row') {
    store.insert(e.business)
    inserted++
    const now = Date.now()
    if (now - lastCountAt > 400) {
      lastCountAt = now
      hub.broadcast({ type: 'count', total: inserted })
    }
    return
  }
  if (e.type === 'job-done') {
    hub.broadcast({ type: 'count', total: inserted })
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
    iterate: (batch) => store.iterateAll(batch),
  },
  startJob: (keywords: string[], locations: LocationSpec[], settings: JobSettings) => {
    store.reset()
    inserted = 0
    lastCountAt = 0
    runner.run(keywords, locations, settings, handleEvent)
  },
  stopJob: () => runner.stop(),
})

const server = createServer(app)
hub = new WsHub(server)
const PORT = 5174
server.listen(PORT, () => console.log(`server on http://localhost:${PORT}`))
