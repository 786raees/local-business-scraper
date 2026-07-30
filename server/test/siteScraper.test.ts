import { describe, it, expect, vi } from 'vitest'
import type { BrowserContext } from 'playwright'
import { harvestHtml, scrapeWebsite } from '../src/scraper/siteScraper.js'

// The browser must never be touched when the static pass finds anything —
// a context that explodes on use proves it.
const forbiddenCtx = {
  newPage: () => { throw new Error('browser used') },
} as unknown as BrowserContext

const PAGE = `
  <html><head><style>a { color: red }</style></head><body>
    <script>var x = "noise@script.js"</script>
    <a href="/contact">Contact</a>
    <a href="mailto:jane@acme.com?subject=hi">Email us</a>
    <a href="https://www.facebook.com/acmedental">Facebook</a>
    <p>Reach us at jane@acme.com</p>
  </body></html>`

describe('harvestHtml', () => {
  it('resolves relative hrefs against the page URL and keeps mailto links raw', () => {
    const { hrefs } = harvestHtml(PAGE, 'https://acme.com/')
    expect(hrefs).toContain('https://acme.com/contact')
    expect(hrefs).toContain('mailto:jane@acme.com?subject=hi')
    expect(hrefs).toContain('https://www.facebook.com/acmedental')
  })

  it('strips scripts, styles and tags from the text', () => {
    const { text } = harvestHtml(PAGE, 'https://acme.com/')
    expect(text).toContain('Reach us at jane@acme.com')
    expect(text).not.toContain('color: red')
    expect(text).not.toContain('noise@script.js')
  })
})

describe('scrapeWebsite — static first (story 06)', () => {
  it('extracts email and socials from static HTML without opening a browser page', async () => {
    const data = await scrapeWebsite(forbiddenCtx, 'https://acme.com', { findOwner: false },
      undefined, { fetchHtml: async () => PAGE })
    expect(data.email).toBe('jane@acme.com')
    expect(data.socials.facebook).toBe('https://www.facebook.com/acmedental')
  })

  it('stops fetching further paths once the stop-early condition is met', async () => {
    const fetchHtml = vi.fn(async () => PAGE)
    await scrapeWebsite(forbiddenCtx, 'https://acme.com', { findOwner: false },
      undefined, { fetchHtml })
    // Non-generic email + a social on the homepage: no need for /contact etc.
    expect(fetchHtml).toHaveBeenCalledTimes(1)
  })

  it('falls back to the browser pass when the static pass yields no signal', async () => {
    const viaBrowser = vi.fn(async (_ctx, _site, _origin, _paths, c: { emails: string[] }) => {
      c.emails.push('found@browser.com')
    })
    const data = await scrapeWebsite(forbiddenCtx, 'https://acme.com', { findOwner: false },
      undefined, { fetchHtml: async () => '<html><body>Loading…</body></html>', viaBrowser })
    expect(viaBrowser).toHaveBeenCalledTimes(1)
    expect(data.email).toBe('found@browser.com')
  })

  it('does not open the browser when static found a partial signal (email only)', async () => {
    const viaBrowser = vi.fn(async () => {})
    const data = await scrapeWebsite(forbiddenCtx, 'https://acme.com', { findOwner: false },
      undefined, { fetchHtml: async () => '<body>write to jane@acme.com</body>', viaBrowser })
    expect(viaBrowser).not.toHaveBeenCalled()
    expect(data.email).toBe('jane@acme.com')
  })

  it('survives every static fetch failing (falls back, then returns empty-handed)', async () => {
    const viaBrowser = vi.fn(async () => {})
    const data = await scrapeWebsite(forbiddenCtx, 'https://acme.com', { findOwner: false },
      undefined, { fetchHtml: async () => { throw new Error('blocked') }, viaBrowser })
    expect(viaBrowser).toHaveBeenCalledTimes(1)
    expect(data.email).toBe('')
  })

  it('returns empty data for an unparsable website URL without any work', async () => {
    const fetchHtml = vi.fn()
    const data = await scrapeWebsite(forbiddenCtx, 'not a url', { findOwner: false },
      undefined, { fetchHtml })
    expect(fetchHtml).not.toHaveBeenCalled()
    expect(data.email).toBe('')
  })
})
