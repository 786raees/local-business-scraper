import { Viewport } from '../geo/grid.js'

/**
 * Build a Google Maps search URL, optionally anchored to a map viewport.
 *
 * The viewport form (`/@lat,lng,Nz`) is what makes segmented scraping work: a plain
 * text search returns at most ~120 results for an area no matter its size, but the
 * same keyword run against many small viewports returns a largely disjoint set each
 * time. Measured on "dentist" in London: plain text 67 results, two 5km tiles 197.
 *
 * `hl=en&gl=us` is not cosmetic. Without it Google localizes the UI outside the US,
 * so aria-labels read "Bewertung"/"Sterne" or "Note"/"avis" and the rating, review
 * count and price-level parsers — which match English words — all silently return
 * nothing across Europe.
 */
export function buildSearchUrl(query: string, viewport?: Viewport): string {
  const path = viewport
    ? `${encodeURIComponent(query)}/@${viewport.lat},${viewport.lng},${viewport.zoom}z`
    : encodeURIComponent(query)
  return `https://www.google.com/maps/search/${path}?hl=en&gl=us`
}

/**
 * A random delay in [min, max]. The previous implementation returned the exact
 * midpoint on every call, producing a perfectly regular request cadence — the
 * easiest possible automation signal to detect.
 */
export function jitter(min: number, max: number): number {
  const lo = Math.max(0, Math.min(min, max))
  const hi = Math.max(0, Math.max(min, max))
  return lo + Math.floor(Math.random() * (hi - lo + 1))
}
