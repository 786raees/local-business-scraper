import { describe, it, expect } from 'vitest'
import { parseRating, parsePriceLevel, extractEmailFromHtml } from '../src/scraper/listingParser.js'

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
