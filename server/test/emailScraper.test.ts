import { describe, it, expect } from 'vitest'
import { findEmailForWebsite, contactUrls, bestEmail } from '../src/scraper/emailScraper.js'

describe('contactUrls', () => {
  it('builds homepage + contact pages from origin', () => {
    expect(contactUrls('https://acme.com/team')).toEqual([
      'https://acme.com', 'https://acme.com/contact', 'https://acme.com/contact-us',
      'https://acme.com/about', 'https://acme.com/about-us',
    ])
  })
  it('returns empty for invalid url', () => {
    expect(contactUrls('not a url')).toEqual([])
  })
})

describe('bestEmail', () => {
  it('prefers a non-generic address over a generic one', () => {
    expect(bestEmail(['info@acme.com', 'jane@acme.com'])).toBe('jane@acme.com')
  })
  it('falls back to generic when no real address', () => {
    expect(bestEmail(['info@acme.com'])).toBe('info@acme.com')
  })
})

describe('findEmailForWebsite', () => {
  it('returns empty for blank website', async () => {
    expect(await findEmailForWebsite('', async () => '')).toBe('')
  })
  it('extracts email from the homepage', async () => {
    const html = '<a href="mailto:hi@acme.com">contact</a>'
    expect(await findEmailForWebsite('https://acme.com', async () => html)).toBe('hi@acme.com')
  })
  it('falls through to a contact page when homepage has none', async () => {
    const fetchHtml = async (url: string) =>
      url.endsWith('/contact') ? 'reach us at sales@acme.com' : '<p>no email here</p>'
    expect(await findEmailForWebsite('https://acme.com', fetchHtml)).toBe('sales@acme.com')
  })
  it('returns empty when every page fails', async () => {
    expect(await findEmailForWebsite('https://x.com', async () => { throw new Error('net') })).toBe('')
  })
})
