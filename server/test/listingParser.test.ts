import { describe, it, expect } from 'vitest'
import { placeIdFromUrl, parseRating, parsePriceLevel, extractEmailFromHtml, extractSocials, cleanText } from '../src/scraper/listingParser.js'

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

describe('placeIdFromUrl', () => {
  // The !19s segment is Google's canonical place ID — stable across map viewports,
  // unlike the surrounding URL which embeds the current centre coordinates.
  const url = 'https://www.google.com/maps/place/tooth+dental+care/data=!4m7!3m6!1s0x48760543eaf539a1:0x7cd4f09ec1707e5!8m2!3d51.5014773!4d-0.1110586!16s%2Fg%2F11qg3f0nkg!19sChIJoTn16kMFdkgR5QcX7AlPzQc?authuser=0&hl=en&rclk=1'

  it('extracts the place id', () => {
    expect(placeIdFromUrl(url)).toBe('ChIJoTn16kMFdkgR5QcX7AlPzQc')
  })

  it('is identical for the same place seen from a different viewport', () => {
    const other = url.replace('!3d51.5014773!4d-0.1110586', '!3d51.5100000!4d-0.1300000')
    expect(placeIdFromUrl(other)).toBe(placeIdFromUrl(url))
  })

  it('falls back to the hex feature id when !19s is absent', () => {
    const legacy = 'https://www.google.com/maps/place/X/data=!4m7!3m6!1s0x48760543eaf539a1:0x7cd4f09ec1707e5!8m2'
    expect(placeIdFromUrl(legacy)).toBe('0x48760543eaf539a1:0x7cd4f09ec1707e5')
  })

  it('returns empty string when no identifier is present', () => {
    expect(placeIdFromUrl('https://www.google.com/maps')).toBe('')
    expect(placeIdFromUrl('')).toBe('')
  })
})

describe('parseRating against the real Maps markup', () => {
  // Maps splits these across two sibling elements inside div.F7nice:
  //   <span role="img" aria-label="4.6 stars ">  and  <span role="img" aria-label="263 reviews">
  // Reading only the first one — as the scraper used to — loses the review count entirely.
  it('reads both values from the combined aria labels', () => {
    expect(parseRating('4.6 stars  263 reviews')).toEqual({ rating: 4.6, reviewCount: 263 })
  })

  it('still reads the rating when only the stars label is present', () => {
    expect(parseRating('4.6 stars ')).toEqual({ rating: 4.6, reviewCount: null })
  })

  it('handles thousands separators in the review count', () => {
    expect(parseRating('4.2 stars  1,284 reviews').reviewCount).toBe(1284)
  })

  it('handles a single review', () => {
    expect(parseRating('5.0 stars  1 review').reviewCount).toBe(1)
  })
})

describe('cleanText', () => {
  it('strips leading Material icon glyphs from addresses', () => {
    expect(cleanText('\ue0c8 4637 SW 75th Ave, Miami, FL 33155'))
      .toBe('4637 SW 75th Ave, Miami, FL 33155')
  })
  it('strips the phone glyph', () => {
    expect(cleanText('\ue0b0 +1 305-697-3490')).toBe('+1 305-697-3490')
  })
  it('collapses newline runs from multi-line hours', () => {
    expect(cleanText('\nOpen 24 hours\n\nUpdated 5 days ago'))
      .toBe('Open 24 hours Updated 5 days ago')
  })
  it('removes PUA glyphs anywhere in the string', () => {
    expect(cleanText('a\ue000b\uf8ffc')).toBe('abc')
  })
  it('passes clean text through unchanged', () => {
    expect(cleanText('Plumber')).toBe('Plumber')
  })
  it('handles empty input', () => {
    expect(cleanText('')).toBe('')
  })
})
