import { BrowserContext } from 'playwright'
import { extractAllEmailsFromHtml, extractSocials } from './listingParser.js'
import { bestEmail } from './emailScraper.js'
import { Socials, SOCIAL_PLATFORMS } from '../types.js'

const CONTACT_PATHS = ['', '/contact', '/contact-us', '/about']

function emptySocials(): Socials {
  return Object.fromEntries(SOCIAL_PLATFORMS.map((p) => [p, ''])) as Socials
}

/** Collect anchor hrefs + mailto addresses + visible HTML from the current page. */
async function harvest(page: import('playwright').Page): Promise<{ hrefs: string[]; html: string }> {
  const hrefs = await page.locator('a[href]').evaluateAll(
    (els) => els.map((e) => (e as HTMLAnchorElement).href),
  ).catch(() => [] as string[])
  const html = await page.content().catch(() => '')
  return { hrefs, html }
}

/**
 * Open a business website in the real browser (renders JS, not blocked like a
 * bare fetch) and extract the best email plus social/directory profile links.
 * Visits the homepage and, if needed, a couple of contact pages.
 */
export async function scrapeWebsite(
  context: BrowserContext,
  website: string,
  signal?: AbortSignal,
): Promise<{ email: string; socials: Socials }> {
  const socials = emptySocials()
  const emails: string[] = []
  let origin: string
  try { origin = new URL(website).origin } catch { return { email: '', socials } }

  const page = await context.newPage()
  // Speed: skip images/media/fonts; we only need markup + links.
  await page.route('**/*', (route) => {
    const t = route.request().resourceType()
    if (t === 'image' || t === 'media' || t === 'font') return route.abort()
    return route.continue()
  }).catch(() => {})

  try {
    for (const path of CONTACT_PATHS) {
      if (signal?.aborted) break
      try {
        await page.goto(path ? `${origin}${path}` : website, { waitUntil: 'domcontentloaded', timeout: 12000 })
        await page.waitForTimeout(600)
        const { hrefs, html } = await harvest(page)

        // mailto + text emails
        for (const h of hrefs) {
          if (h.toLowerCase().startsWith('mailto:')) emails.push(h.slice(7).split('?')[0])
        }
        emails.push(...extractAllEmailsFromHtml(html))

        // socials — fill any platform we haven't found yet
        const found = extractSocials(hrefs)
        for (const p of SOCIAL_PLATFORMS) if (!socials[p] && found[p]) socials[p] = found[p]
      } catch { /* skip this page */ }

      // Stop early once we have a real email and at least one social link.
      const haveEmail = emails.some((e) => e && !/^(info|contact|hello|admin|office|support|sales|mail)@/i.test(e))
      const haveSocial = SOCIAL_PLATFORMS.some((p) => socials[p])
      if (haveEmail && haveSocial) break
    }
  } finally {
    await page.close().catch(() => {})
  }

  return { email: bestEmail(emails), socials }
}
