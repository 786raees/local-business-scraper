import { extractAllEmailsFromHtml } from './listingParser.js'

const CONTACT_PATHS = ['', 'contact', 'contact-us', 'about', 'about-us']

// Generic inbox addresses are still useful but lower priority than a "real" one.
const GENERIC = /^(info|contact|hello|admin|office|support|sales|mail)@/i

/** Build candidate page URLs (homepage + common contact pages) for a site. */
export function contactUrls(website: string): string[] {
  let base: URL
  try { base = new URL(website) } catch { return [] }
  const origin = base.origin
  return CONTACT_PATHS.map((p) => (p ? `${origin}/${p}` : origin))
}

/** Pick the best email: prefer a non-generic address, else the first generic one. */
export function bestEmail(emails: string[]): string {
  const unique = [...new Set(emails.map((e) => e.toLowerCase()))]
  if (!unique.length) return ''
  const real = unique.find((e) => !GENERIC.test(e))
  return real ?? unique[0]
}

/**
 * Fetch the homepage plus common contact pages, collect every email, and return
 * the best one. `fetchHtml` is injectable for testing. Pages that fail are skipped.
 */
export async function findEmailForWebsite(
  website: string,
  fetchHtml: (url: string) => Promise<string>,
): Promise<string> {
  if (!website) return ''
  const urls = contactUrls(website)
  const found: string[] = []
  for (const url of urls) {
    try {
      const html = await fetchHtml(url)
      const emails = extractAllEmailsFromHtml(html)
      found.push(...emails)
      // A non-generic hit is good enough; stop early to save requests.
      if (emails.some((e) => !GENERIC.test(e))) break
    } catch { /* skip unreachable page */ }
  }
  return bestEmail(found)
}
