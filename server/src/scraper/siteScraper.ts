import { BrowserContext } from 'playwright'
import { extractAllEmailsFromHtml, extractSocials } from './listingParser.js'
import { bestEmail } from './emailScraper.js'
import { extractOwner } from './ownerExtract.js'
import { whoisOwner } from './whois.js'
import { Socials, SOCIAL_PLATFORMS } from '../types.js'

export const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

const CONTACT_PATHS = ['', '/contact', '/contact-us', '/about']
// Extra pages worth visiting when hunting for the owner's name.
const OWNER_PATHS = ['/about-us', '/team', '/our-team', '/meet-the-team', '/staff']

export interface SiteData {
  email: string
  socials: Socials
  ownerName: string
  ownerTitle: string
  ownerSource: string
}

export type FetchHtml = (url: string) => Promise<string>

/** Plain HTTP fetch of a page — ~50ms against seconds for a rendered browser page. */
const defaultFetchHtml: FetchHtml = async (url) => {
  const res = await fetch(url, {
    headers: { 'user-agent': UA, accept: 'text/html' },
    signal: AbortSignal.timeout(8000),
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const type = res.headers.get('content-type') ?? ''
  if (type && !type.includes('html')) throw new Error(`not html: ${type}`)
  return res.text()
}

function emptySocials(): Socials {
  return Object.fromEntries(SOCIAL_PLATFORMS.map((p) => [p, ''])) as Socials
}

const HREF_RE = /href\s*=\s*["']([^"']+)["']/gi

/**
 * The static-mode equivalent of reading a rendered page: anchor hrefs (resolved
 * absolute so the social matchers see full hosts) and a rough visible-text
 * approximation for the owner NLP.
 */
export function harvestHtml(html: string, baseUrl: string): { hrefs: string[]; text: string } {
  const hrefs: string[] = []
  for (const m of html.matchAll(HREF_RE)) {
    const raw = m[1]
    if (raw.toLowerCase().startsWith('mailto:')) { hrefs.push(raw); continue }
    try { hrefs.push(new URL(raw, baseUrl).href) } catch { /* not a URL */ }
  }
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
  return { hrefs, text }
}

/** Mutable accumulator shared by the static and browser passes. */
interface Collected {
  emails: string[]
  socials: Socials
  owner: { name: string; title: string } | null
}

function collect(c: Collected, hrefs: string[], html: string, text: string, findOwner: boolean): void {
  for (const h of hrefs) {
    if (h.toLowerCase().startsWith('mailto:')) c.emails.push(h.slice(7).split('?')[0])
  }
  c.emails.push(...extractAllEmailsFromHtml(html))
  const found = extractSocials(hrefs)
  for (const p of SOCIAL_PLATFORMS) if (!c.socials[p] && found[p]) c.socials[p] = found[p]
  if (findOwner && !c.owner) c.owner = extractOwner(text)
}

function satisfied(c: Collected, findOwner: boolean): boolean {
  const haveEmail = c.emails.some((e) => e && !/^(info|contact|hello|admin|office|support|sales|mail)@/i.test(e))
  const haveSocial = SOCIAL_PLATFORMS.some((p) => c.socials[p])
  const ownerDone = !findOwner || !!c.owner
  return haveEmail && haveSocial && ownerDone
}

function anySignal(c: Collected): boolean {
  return c.emails.length > 0 || SOCIAL_PLATFORMS.some((p) => c.socials[p]) || !!c.owner
}

export type BrowserPass = (
  context: BrowserContext,
  website: string,
  origin: string,
  paths: string[],
  c: Collected,
  findOwner: boolean,
  signal?: AbortSignal,
) => Promise<void>

/**
 * The original Playwright path — needed for JS-rendered sites where the raw
 * HTML carries none of the contact data.
 */
const browserPass: BrowserPass = async (context, website, origin, paths, c, findOwner, signal) => {
  const page = await context.newPage()
  // Speed: skip images/media/fonts; we only need markup + links + text.
  await page.route('**/*', (route) => {
    const t = route.request().resourceType()
    if (t === 'image' || t === 'media' || t === 'font') return route.abort()
    return route.continue()
  }).catch(() => {})

  try {
    for (const path of paths) {
      if (signal?.aborted) break
      try {
        await page.goto(path ? `${origin}${path}` : website, { waitUntil: 'domcontentloaded', timeout: 12000 })
        await page.waitForTimeout(600)
        const hrefs = await page.locator('a[href]').evaluateAll(
          (els) => els.map((e) => (e as HTMLAnchorElement).href),
        ).catch(() => [] as string[])
        const html = await page.content().catch(() => '')
        const text = await page.innerText('body').catch(() => '')
        collect(c, hrefs, html, text, findOwner)
      } catch { /* skip this page */ }
      if (satisfied(c, findOwner)) break
    }
  } finally {
    await page.close().catch(() => {})
  }
}

/**
 * Extract the best email plus social/directory profile links (and optionally an
 * owner name) from a business website.
 *
 * Static-first (story 06): every path is tried with a plain fetch and the same
 * extractors run on the raw HTML — most small-business sites surface all of it
 * there. The real browser is opened only when the static pass yields no signal
 * at all (JS-rendered site, fetch blocked). `deps` is injectable for tests.
 */
export async function scrapeWebsite(
  context: BrowserContext,
  website: string,
  opts: { findOwner: boolean },
  signal?: AbortSignal,
  deps: { fetchHtml?: FetchHtml; viaBrowser?: BrowserPass } = {},
): Promise<SiteData> {
  const fetchHtml = deps.fetchHtml ?? defaultFetchHtml
  const viaBrowser = deps.viaBrowser ?? browserPass
  const c: Collected = { emails: [], socials: emptySocials(), owner: null }
  let origin: string
  try { origin = new URL(website).origin } catch {
    return { email: '', socials: c.socials, ownerName: '', ownerTitle: '', ownerSource: '' }
  }

  const paths = opts.findOwner ? [...CONTACT_PATHS, ...OWNER_PATHS] : CONTACT_PATHS

  for (const path of paths) {
    if (signal?.aborted) break
    try {
      const url = path ? `${origin}${path}` : website
      const html = await fetchHtml(url)
      const { hrefs, text } = harvestHtml(html, url)
      collect(c, hrefs, html, text, opts.findOwner)
    } catch { /* page unreachable statically */ }
    if (satisfied(c, opts.findOwner)) break
  }

  if (!anySignal(c) && !signal?.aborted) {
    await viaBrowser(context, website, origin, paths, c, opts.findOwner, signal)
  }

  // WHOIS registrant as a fallback owner source.
  let ownerName = c.owner?.name ?? ''
  let ownerTitle = c.owner?.title ?? ''
  let ownerSource = c.owner ? 'website' : ''
  if (opts.findOwner && !ownerName) {
    const w = await whoisOwner(website).catch(() => '')
    if (w) { ownerName = w; ownerTitle = 'Registrant'; ownerSource = 'whois' }
  }

  return { email: bestEmail(c.emails), socials: c.socials, ownerName, ownerTitle, ownerSource }
}
