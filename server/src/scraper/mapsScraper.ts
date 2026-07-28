import { chromium, Browser, BrowserContext, Page } from 'playwright'
import { Business, JobSettings, emptyBusiness } from '../types.js'
import { SELECTORS } from './selectors.js'
import { parseRating, parsePriceLevel, placeIdFromUrl, cleanText } from './listingParser.js'
import { buildSearchUrl, jitter } from './searchUrl.js'
import { Viewport } from '../geo/grid.js'
import { scrapeWebsite } from './siteScraper.js'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

function delay(min: number, max: number): Promise<void> {
  return new Promise((r) => setTimeout(r, jitter(min, max)))
}

async function dismissConsent(page: Page): Promise<void> {
  try {
    const btn = page.locator(SELECTORS.consentAccept).first()
    if (await btn.isVisible({ timeout: 3000 })) {
      await btn.click()
      await page.waitForTimeout(1000)
    }
  } catch { /* no consent shown */ }
}

async function scrollFeed(page: Page, maxResults: number, signal?: AbortSignal): Promise<string[]> {
  const seen = new Set<string>()
  let stagnant = 0
  while (seen.size < maxResults && stagnant < 4) {
    if (signal?.aborted) break
    const links = await page.locator(SELECTORS.resultLink).evaluateAll(
      (els) => els.map((e) => (e as HTMLAnchorElement).href),
    )
    const before = seen.size
    for (const l of links) if (seen.size < maxResults) seen.add(l)
    if (seen.size === before) stagnant++; else stagnant = 0
    await page.locator(SELECTORS.feed).evaluate((el) => el.scrollBy(0, el.scrollHeight))
    await page.waitForTimeout(1500)
  }
  return [...seen].slice(0, maxResults)
}

async function textOrEmpty(page: Page, selector: string): Promise<string> {
  try {
    const el = page.locator(selector).first()
    if (await el.count()) return cleanText(await el.innerText())
  } catch { /* ignore */ }
  return ''
}

async function scrapeDetail(page: Page, url: string, keyword: string, location: string): Promise<Business> {
  const b = emptyBusiness(keyword, location)
  b.mapsUrl = url
  b.placeId = placeIdFromUrl(url)
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(SELECTORS.detailName, { timeout: 15000 }).catch(() => {})
  b.name = await textOrEmpty(page, SELECTORS.detailName)
  b.address = await textOrEmpty(page, SELECTORS.detailAddress)
  b.phone = await textOrEmpty(page, SELECTORS.detailPhone)
  b.category = await textOrEmpty(page, SELECTORS.detailCategory)
  b.hours = await textOrEmpty(page, SELECTORS.detailHours)
  b.priceLevel = parsePriceLevel(await textOrEmpty(page, SELECTORS.detailPriceLevel))
  try {
    const w = page.locator(SELECTORS.detailWebsite).first()
    if (await w.count()) b.website = (await w.getAttribute('href')) ?? ''
  } catch { /* ignore */ }
  try {
    // Maps puts the rating and the review count in two sibling aria-labels
    // ("4.6 stars " and "263 reviews"), so both must be collected — reading only the
    // first yields a rating with a permanently null review count.
    const labels = await page.locator(SELECTORS.detailRatingAria).evaluateAll(
      (els) => els.map((e) => e.getAttribute('aria-label') ?? ''),
    )
    const parsed = parseRating(labels.join(' '))
    b.rating = parsed.rating; b.reviewCount = parsed.reviewCount
  } catch { /* ignore */ }
  return b
}

export async function scrapeMaps(
  keyword: string,
  location: string,
  settings: JobSettings,
  onRow: (b: Business) => void,
  signal?: AbortSignal,
  viewport?: Viewport,
): Promise<Business[]> {
  // With a viewport the map itself defines the area, so the location text is omitted —
  // leaving it in would make Google re-centre on the named place and undo the tiling.
  const query = viewport ? keyword : `${keyword} ${location}`.trim()
  const browser: Browser = await chromium.launch({ headless: settings.headless })
  const out: Business[] = []
  try {
    const ctx = await browser.newContext({ userAgent: UA, locale: 'en-US' })
    const page = await ctx.newPage()
    await page.goto(buildSearchUrl(query, viewport), { waitUntil: 'domcontentloaded' })
    await dismissConsent(page)
    await page.waitForSelector(SELECTORS.feed, { timeout: 15000 }).catch(() => {})
    const urls = await scrollFeed(page, settings.maxResults, signal)
    for (const url of urls) {
      if (signal?.aborted) break
      const b = await scrapeDetail(page, url, keyword, location)
      // Open the business website to pull email + socials (+ owner if requested).
      if ((settings.extractEmail || settings.findOwner) && b.website) {
        try {
          const site = await scrapeWebsite(ctx as BrowserContext, b.website, { findOwner: settings.findOwner }, signal)
          b.email = site.email
          b.facebook = site.socials.facebook; b.instagram = site.socials.instagram; b.twitter = site.socials.twitter
          b.linkedin = site.socials.linkedin; b.youtube = site.socials.youtube; b.tiktok = site.socials.tiktok
          b.yelp = site.socials.yelp; b.yellowpages = site.socials.yellowpages
          b.ownerName = site.ownerName; b.ownerTitle = site.ownerTitle; b.ownerSource = site.ownerSource
        } catch { /* website unreachable — keep GMB data */ }
      }
      if (b.name) { out.push(b); onRow(b) }
      await delay(settings.delayMinMs, settings.delayMaxMs)
    }
  } finally {
    await browser.close()
  }
  return out
}
