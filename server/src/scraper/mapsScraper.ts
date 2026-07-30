import { chromium, Browser, BrowserContext, Page } from 'playwright'
import { Business, JobSettings, emptyBusiness } from '../types.js'
import { classifyPhone } from '../phone/lineType.js'
import { SELECTORS } from './selectors.js'
import { parseRating, parsePriceLevel, placeIdFromUrl, cleanText } from './listingParser.js'
import { buildSearchUrl, jitter } from './searchUrl.js'
import { Viewport } from '../geo/grid.js'
import { scrapeWebsite, UA } from './siteScraper.js'
import { EnrichPool } from './enrichPool.js'

export type OnRow = (b: Business, update?: boolean) => void
export type IsKnown = (placeId: string) => boolean

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

/**
 * Split feed URLs into fresh (worth a detail visit) and known (already stored).
 * A URL whose place id cannot be parsed is always fresh — dropping unidentifiable
 * results would silently lose real businesses; the store keeps NULL placeIds
 * distinct for the same reason.
 */
export function partitionUrls(urls: string[], isKnown: IsKnown): { fresh: string[]; known: string[] } {
  const fresh: string[] = []
  const known: string[] = []
  for (const url of urls) {
    const id = placeIdFromUrl(url)
    if (id && isKnown(id)) known.push(url)
    else fresh.push(url)
  }
  return { fresh, known }
}

/** Scroll-loop stop bookkeeping, pure so the stop conditions are unit-testable. */
export interface FeedProgress { stagnant: number; knownRounds: number }

export function advanceFeedProgress(p: FeedProgress, newUrls: number, freshAdded: number): FeedProgress {
  if (!newUrls) return { stagnant: p.stagnant + 1, knownRounds: p.knownRounds }
  return { stagnant: 0, knownRounds: freshAdded ? 0 : p.knownRounds + 1 }
}

/**
 * Give up on a tile when the feed stops growing — or when two consecutive rounds
 * brought only already-known places: an exhausted overlap tile isn't worth
 * scrolling to the bottom of.
 */
export function feedExhausted(p: FeedProgress): boolean {
  return p.stagnant >= 4 || p.knownRounds >= 2
}

/**
 * Wait for the feed to grow past `prevCount` links, polling instead of the old
 * unconditional 1500ms sleep — most scroll rounds render new results well before
 * the cap, so the fixed sleep wasted most of its time.
 */
async function waitForFeedGrowth(page: Page, prevCount: number, capMs = 1500, stepMs = 250): Promise<void> {
  for (let waited = 0; waited < capMs; waited += stepMs) {
    await page.waitForTimeout(stepMs)
    const n = await page.locator(SELECTORS.resultLink).count().catch(() => prevCount)
    if (n > prevCount) return
  }
}

/**
 * Scroll the results feed collecting *fresh* URLs (known places filtered out
 * before any navigation — story 06). Stops when the fresh budget is met, the
 * feed stagnates, or two consecutive rounds brought only already-known places
 * (an exhausted overlap tile isn't worth scrolling to the bottom of).
 */
async function scrollFeed(page: Page, maxFresh: number, isKnown: IsKnown, signal?: AbortSignal): Promise<string[]> {
  const seen = new Set<string>()
  const freshIds = new Set<string>()
  const fresh: string[] = []
  let progress: FeedProgress = { stagnant: 0, knownRounds: 0 }
  while (fresh.length < maxFresh && !feedExhausted(progress)) {
    if (signal?.aborted) break
    const links = await page.locator(SELECTORS.resultLink).evaluateAll(
      (els) => els.map((e) => (e as HTMLAnchorElement).href),
    )
    const newUrls = links.filter((l) => !seen.has(l))
    for (const l of newUrls) seen.add(l)
    let freshAdded = 0
    for (const url of partitionUrls(newUrls, isKnown).fresh) {
      if (fresh.length >= maxFresh) break
      // The same place can surface under several URLs within one tile; dedup on id.
      const id = placeIdFromUrl(url)
      if (id) {
        if (freshIds.has(id)) continue
        freshIds.add(id)
      }
      fresh.push(url)
      freshAdded++
    }
    progress = advanceFeedProgress(progress, newUrls.length, freshAdded)
    await page.locator(SELECTORS.feed).evaluate((el) => el.scrollBy(0, el.scrollHeight))
    await waitForFeedGrowth(page, links.length)
  }
  return fresh
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
  // Line type is classified here, at row finalize — never in the store, which
  // stays a dumb persistence layer. A phoneless row gets 'unknown' explicitly.
  const line = classifyPhone(b.phone)
  b.lineType = line.lineType; b.lineCarrier = line.lineCarrier
  return b
}

export interface MapsSession {
  scrape(
    keyword: string, location: string, settings: JobSettings,
    onRow: OnRow, signal?: AbortSignal, viewport?: Viewport,
  ): Promise<Business[]>
  /** Resolves when queued enrichment work has finished. */
  drain(): Promise<void>
  /** Drops queued enrichment and closes the browser. Safe on abort. */
  close(): Promise<void>
}

/**
 * One browser for the whole job (story 06) — the old per-task launch paid a
 * cold start plus consent dismissal for every grid tile, pure overhead at
 * 100+ tiles. Enrichment runs through a small pool against third-party sites
 * while google.com navigation stays strictly serial with randomized delays.
 */
export async function createMapsSession(settings: JobSettings, isKnown: IsKnown = () => false): Promise<MapsSession> {
  const browser: Browser = await chromium.launch({ headless: settings.headless })
  const ctx: BrowserContext = await browser.newContext({ userAgent: UA, locale: 'en-US' })
  const pool = new EnrichPool(3)

  async function scrape(
    keyword: string, location: string, taskSettings: JobSettings,
    onRow: OnRow, signal?: AbortSignal, viewport?: Viewport,
  ): Promise<Business[]> {
    // With a viewport the map itself defines the area, so the location text is omitted —
    // leaving it in would make Google re-centre on the named place and undo the tiling.
    const query = viewport ? keyword : `${keyword} ${location}`.trim()
    const out: Business[] = []
    const page = await ctx.newPage()
    try {
      await page.goto(buildSearchUrl(query, viewport), { waitUntil: 'domcontentloaded' })
      await dismissConsent(page)
      await page.waitForSelector(SELECTORS.feed, { timeout: 15000 }).catch(() => {})
      const urls = await scrollFeed(page, taskSettings.maxResults, isKnown, signal)
      for (const url of urls) {
        if (signal?.aborted) break
        const b = await scrapeDetail(page, url, keyword, location)
        if (b.name) {
          out.push(b)
          // Emit with GMB data immediately — the budget counts it, the user
          // sees it; enrichment lands later as a merge update.
          onRow(b)
          if ((taskSettings.extractEmail || taskSettings.findOwner) && b.website) {
            pool.push(async () => {
              const site = await scrapeWebsite(ctx, b.website, { findOwner: taskSettings.findOwner }, signal)
              onRow({
                ...b,
                email: site.email,
                facebook: site.socials.facebook, instagram: site.socials.instagram,
                twitter: site.socials.twitter, linkedin: site.socials.linkedin,
                youtube: site.socials.youtube, tiktok: site.socials.tiktok,
                yelp: site.socials.yelp, yellowpages: site.socials.yellowpages,
                ownerName: site.ownerName, ownerTitle: site.ownerTitle, ownerSource: site.ownerSource,
              }, true)
            })
          }
        }
        // Politeness delay only after a real navigation — skipped known URLs cost zero.
        await delay(taskSettings.delayMinMs, taskSettings.delayMaxMs)
      }
    } finally {
      await page.close().catch(() => {})
    }
    return out
  }

  return {
    scrape,
    drain: () => pool.drain(),
    close: async () => {
      pool.abort()
      await browser.close()
    },
  }
}

/**
 * One-shot convenience (and the live smoke test's entry point): a session for a
 * single search, drained and closed.
 */
export async function scrapeMaps(
  keyword: string,
  location: string,
  settings: JobSettings,
  onRow: OnRow,
  signal?: AbortSignal,
  viewport?: Viewport,
  isKnown: IsKnown = () => false,
): Promise<Business[]> {
  const session = await createMapsSession(settings, isKnown)
  try {
    const rows = await session.scrape(keyword, location, settings, onRow, signal, viewport)
    await session.drain()
    return rows
  } finally {
    await session.close()
  }
}
