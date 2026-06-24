import { createServer } from 'node:http'
import { createApp } from './api/routes.js'
import { WsHub } from './ws/hub.js'
import { listCountries, listStates, listCities } from './geo/geoData.js'
import { lookupZips } from './geo/zipLookup.js'
import { JobRunner } from './queue/jobRunner.js'
import { scrapeMaps } from './scraper/mapsScraper.js'
import { findEmailForWebsite } from './scraper/emailScraper.js'
import { JobSettings, LocationSpec, Business } from './types.js'

let hub: WsHub
const runner = new JobRunner(async (keyword, location, settings, onRow, signal) => {
  return scrapeMaps(keyword, location, settings, async (b: Business) => {
    if (settings.extractEmail && b.website) {
      b.email = await findEmailForWebsite(b.website, async (url) => {
        const res = await fetch(url); return res.text()
      })
    }
    onRow(b)
  }, signal)
})

const app = createApp({
  geo: {
    countries: listCountries,
    states: listStates,
    cities: listCities,
    zips: (c, s, city) => lookupZips(c, s, city),
  },
  startJob: (keywords: string[], locations: LocationSpec[], settings: JobSettings) => {
    runner.run(keywords, locations, settings, (e) => hub.broadcast(e))
  },
  stopJob: () => runner.stop(),
})

const server = createServer(app)
hub = new WsHub(server)
const PORT = 5174
server.listen(PORT, () => console.log(`server on http://localhost:${PORT}`))
