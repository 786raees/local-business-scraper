import { describe, it, expect } from 'vitest'
import { scrapeMaps } from '../src/scraper/mapsScraper.js'

// Network-dependent. Skipped unless RUN_SMOKE=1 to keep unit runs offline/fast.
const maybe = process.env.RUN_SMOKE ? it : it.skip

describe('scrapeMaps (smoke)', () => {
  maybe('returns at least one named business for a real search', async () => {
    const rows: string[] = []
    const result = await scrapeMaps(
      'coffee', 'Miami, Florida',
      { maxResults: 5, extractEmail: false, headless: true, delayMinMs: 400, delayMaxMs: 800 },
      (b) => rows.push(b.name),
    )
    expect(result.length).toBeGreaterThan(0)
    expect(result[0].name.length).toBeGreaterThan(0)
  }, 120000)
})
