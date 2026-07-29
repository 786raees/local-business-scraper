import { describe, it, expect } from 'vitest'
import { buildSearchUrl, jitter } from '../src/scraper/searchUrl.js'

describe('buildSearchUrl', () => {
  it('builds a plain text search when no viewport is given', () => {
    const u = new URL(buildSearchUrl('dentist London'))
    expect(u.pathname).toBe('/maps/search/dentist%20London')
  })

  it('anchors the search to a viewport when one is given', () => {
    const u = buildSearchUrl('dentist', { lat: 51.5074, lng: -0.1278, zoom: 15 })
    expect(u).toContain('/maps/search/dentist/@51.5074,-0.1278,15z')
  })

  // Without this, Google serves a localized UI in Europe: aria-labels become
  // "Bewertung"/"Sterne" or "Note"/"avis", so parseRating's /star/i and /review/i
  // never match and every European row comes back with a null rating.
  it('forces the English UI so aria-label parsing works outside the US', () => {
    const u = new URL(buildSearchUrl('zahnarzt', { lat: 52.52, lng: 13.405, zoom: 14 }))
    expect(u.searchParams.get('hl')).toBe('en')
    expect(u.searchParams.get('gl')).toBe('us')
  })

  it('forces English on plain text searches too', () => {
    expect(new URL(buildSearchUrl('dentist')).searchParams.get('hl')).toBe('en')
  })

  it('escapes characters that would break the path', () => {
    const u = buildSearchUrl('café & bar / bistro')
    expect(u).not.toMatch(/ bar/)
    expect(() => new URL(u)).not.toThrow()
  })

  it('keeps enough coordinate precision to distinguish adjacent tiles', () => {
    const a = buildSearchUrl('x', { lat: 51.50740, lng: -0.12780, zoom: 15 })
    const b = buildSearchUrl('x', { lat: 51.50751, lng: -0.12791, zoom: 15 })
    expect(a).not.toBe(b)
  })
})

describe('jitter', () => {
  // The previous implementation returned min + (max-min)*0.5 — the exact midpoint,
  // every single time, giving a perfectly constant request interval.
  it('varies between calls', () => {
    const seen = new Set(Array.from({ length: 40 }, () => jitter(100, 900)))
    expect(seen.size).toBeGreaterThan(5)
  })

  it('stays within the requested bounds', () => {
    for (let i = 0; i < 200; i++) {
      const v = jitter(100, 900)
      expect(v).toBeGreaterThanOrEqual(100)
      expect(v).toBeLessThanOrEqual(900)
    }
  })

  it('handles min equal to max', () => {
    expect(jitter(500, 500)).toBe(500)
  })

  it('handles max below min without returning a negative delay', () => {
    expect(jitter(500, 100)).toBeGreaterThanOrEqual(0)
  })
})
