import { BrowserContext } from 'playwright'
import { extractAllEmailsFromHtml, extractSocials } from './listingParser.js'
import { bestEmail } from './emailScraper.js'
import { extractOwner } from './ownerExtract.js'
import { whoisOwner } from './whois.js'
import { Socials, SOCIAL_PLATFORMS } from '../types.js'

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

function emptySocials(): Socials {
  return Object.fromEntries(SOCIAL_PLATFORMS.map((p) => [p, ''])) as Socials
}

/** Collect anchor hrefs, HTML, and visible text from the current page. */
async function harvest(page: import('playwright').Page): Promise<{ hrefs: string[]; html: string; text: string }> {
  const hrefs = await page.locator('a[href]').evaluateAll(
    (els) => els.map((e) => (e as HTMLAnchorElement).href),
  ).catch(() => [] as string[])
  const html = await page.content().catch(() => '')
  const text = await page.innerText('body').catch(() => '')
  return { hrefs, html, text }
}

/**
 * Open a business website in the real browser (renders JS, not blocked like a
 * bare fetch) and extract the best email plus social/directory profile links.
 * Visits the homepage and, if needed, a couple of contact pages.
 */
export async function scrapeWebsite(
  context: BrowserContext,
  website: string,
  opts: { findOwner: boolean },
  signal?: AbortSignal,
): Promise<SiteData> {
  const socials = emptySocials()
  const emails: string[] = []
  let owner: { name: string; title: string } | null = null
  let origin: string
  try { origin = new URL(website).origin } catch {
    return { email: '', socials, ownerName: '', ownerTitle: '', ownerSource: '' }
  }

  const paths = opts.findOwner ? [...CONTACT_PATHS, ...OWNER_PATHS] : CONTACT_PATHS

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
        const { hrefs, html, text } = await harvest(page)

        for (const h of hrefs) {
          if (h.toLowerCase().startsWith('mailto:')) emails.push(h.slice(7).split('?')[0])
        }
        emails.push(...extractAllEmailsFromHtml(html))

        const found = extractSocials(hrefs)
        for (const p of SOCIAL_PLATFORMS) if (!socials[p] && found[p]) socials[p] = found[p]

        if (opts.findOwner && !owner) owner = extractOwner(text)
      } catch { /* skip this page */ }

      const haveEmail = emails.some((e) => e && !/^(info|contact|hello|admin|office|support|sales|mail)@/i.test(e))
      const haveSocial = SOCIAL_PLATFORMS.some((p) => socials[p])
      const ownerDone = !opts.findOwner || !!owner
      if (haveEmail && haveSocial && ownerDone) break
    }
  } finally {
    await page.close().catch(() => {})
  }

  // WHOIS registrant as a fallback owner source.
  let ownerName = owner?.name ?? ''
  let ownerTitle = owner?.title ?? ''
  let ownerSource = owner ? 'website' : ''
  if (opts.findOwner && !ownerName) {
    const w = await whoisOwner(website).catch(() => '')
    if (w) { ownerName = w; ownerTitle = 'Registrant'; ownerSource = 'whois' }
  }

  return { email: bestEmail(emails), socials, ownerName, ownerTitle, ownerSource }
}
