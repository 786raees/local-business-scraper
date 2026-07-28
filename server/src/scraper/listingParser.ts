/**
 * Google renders a Material icon before the address/phone/hours text, and its ligature
 * codepoint lands in innerText as a Private Use Area character (U+E0C8 address,
 * U+E0B0 phone). These are not whitespace, so trim() cannot remove them — they must be
 * stripped explicitly or they end up in the DB, the CSV, and every Sheets export.
 */
export function cleanText(s: string): string {
  return s
    .replace(/[\ue000-\uf8ff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Google's canonical place id, pulled from the `!19s` segment of a Maps place URL.
 * This is the only stable identity across map viewports — the rest of the URL embeds
 * the current map centre, so the same business yields different URLs from different
 * grid tiles. Older/short URLs fall back to the `!1s` hex feature id.
 */
export function placeIdFromUrl(url: string): string {
  if (!url) return ''
  return url.match(/!19s([^!?&]+)/)?.[1]
    ?? url.match(/!1s(0x[0-9a-f]+:0x[0-9a-f]+)/i)?.[1]
    ?? ''
}

export function parseRating(aria: string): { rating: number | null; reviewCount: number | null } {
  if (!aria) return { rating: null, reviewCount: null }
  const ratingMatch = aria.match(/([0-9]+(?:\.[0-9]+)?)\s*star/i)
  const reviewMatch = aria.match(/([0-9][0-9,]*)\s*review/i)
  return {
    rating: ratingMatch ? parseFloat(ratingMatch[1]) : null,
    reviewCount: reviewMatch ? parseInt(reviewMatch[1].replace(/,/g, ''), 10) : null,
  }
}

export function parsePriceLevel(text: string): string {
  const m = text.match(/\${1,4}(?!\w)/)
  return m ? m[0] : ''
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
const BAD_EXT = /\.(png|jpe?g|gif|webp|svg|css|js)$/i

/** All plausible (deduped) emails on a page, asset-like matches removed. */
export function extractAllEmailsFromHtml(html: string): string[] {
  const matches = html.match(EMAIL_RE) ?? []
  const out: string[] = []
  for (const m of matches) {
    if (!BAD_EXT.test(m) && !m.startsWith('@') && !out.includes(m)) out.push(m)
  }
  return out
}

export function extractEmailFromHtml(html: string): string {
  return extractAllEmailsFromHtml(html)[0] ?? ''
}

// Map each social platform to the host fragments that identify it.
const SOCIAL_MATCHERS: Record<string, string[]> = {
  facebook: ['facebook.com/', 'fb.com/'],
  instagram: ['instagram.com/'],
  twitter: ['twitter.com/', 'x.com/'],
  linkedin: ['linkedin.com/'],
  youtube: ['youtube.com/', 'youtu.be/'],
  tiktok: ['tiktok.com/'],
  yelp: ['yelp.com/'],
  yellowpages: ['yellowpages.com/', 'yellowpages.ca/'],
}

// Profile/share links to ignore (sharer widgets, not the business's own page).
const SOCIAL_IGNORE = ['/sharer', '/share?', 'intent/tweet', 'plugins/', '/login', '/signup']

/** First own-profile URL per platform, drawn from a list of anchor hrefs. */
export function extractSocials(hrefs: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of hrefs) {
    if (!raw) continue
    const href = raw.trim()
    const lower = href.toLowerCase()
    if (SOCIAL_IGNORE.some((s) => lower.includes(s))) continue
    for (const [platform, fragments] of Object.entries(SOCIAL_MATCHERS)) {
      if (out[platform]) continue
      if (fragments.some((f) => lower.includes(f))) out[platform] = href
    }
  }
  return out
}
