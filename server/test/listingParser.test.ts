import { describe, it, expect } from 'vitest'
import { parseRating, parsePriceLevel, extractEmailFromHtml, extractSocials } from '../src/scraper/listingParser.js'

describe('parseRating', () => {
  it('parses rating and review count from aria label', () => {
    expect(parseRating('4.5 stars 1,234 reviews')).toEqual({ rating: 4.5, reviewCount: 1234 })
  })
  it('returns nulls when absent', () => {
    expect(parseRating('')).toEqual({ rating: null, reviewCount: null })
  })
})

describe('parsePriceLevel', () => {
  it('extracts dollar signs', () => {
    expect(parsePriceLevel('Price: $$ · Plumber')).toBe('$$')
  })
  it('returns empty when none', () => {
    expect(parsePriceLevel('Plumber')).toBe('')
  })
})

describe('extractEmailFromHtml', () => {
  it('finds first email, ignores asset-like matches', () => {
    expect(extractEmailFromHtml('<a href="mailto:info@acme.com">x</a>')).toBe('info@acme.com')
  })
  it('returns empty when none', () => {
    expect(extractEmailFromHtml('<p>no contact</p>')).toBe('')
  })
})

describe('extractSocials', () => {
  it('detects the business profile per platform', () => {
    const s = extractSocials([
      'https://www.facebook.com/acmeplumbing',
      'https://instagram.com/acme',
      'https://x.com/acme',
      'https://www.yelp.com/biz/acme-miami',
      'https://www.yellowpages.com/miami-fl/acme',
      'https://maps.google.com/whatever',
    ])
    expect(s.facebook).toContain('facebook.com/acmeplumbing')
    expect(s.instagram).toContain('instagram.com/acme')
    expect(s.twitter).toContain('x.com/acme')
    expect(s.yelp).toContain('yelp.com/biz/acme')
    expect(s.yellowpages).toContain('yellowpages.com')
  })
  it('ignores share/sharer widget links', () => {
    const s = extractSocials(['https://www.facebook.com/sharer/sharer.php?u=acme.com'])
    expect(s.facebook).toBeUndefined()
  })
})
