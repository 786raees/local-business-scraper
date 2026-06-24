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

export function extractEmailFromHtml(html: string): string {
  const matches = html.match(EMAIL_RE) ?? []
  for (const m of matches) {
    if (!BAD_EXT.test(m) && !m.startsWith('@')) return m
  }
  return ''
}
