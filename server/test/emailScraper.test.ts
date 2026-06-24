import { describe, it, expect } from 'vitest'
import { findEmailForWebsite } from '../src/scraper/emailScraper.js'

describe('findEmailForWebsite', () => {
  it('returns empty for blank website', async () => {
    expect(await findEmailForWebsite('', async () => '')).toBe('')
  })
  it('extracts email from fetched html', async () => {
    const html = '<a href="mailto:hi@acme.com">contact</a>'
    expect(await findEmailForWebsite('https://acme.com', async () => html)).toBe('hi@acme.com')
  })
  it('returns empty when fetch throws', async () => {
    expect(await findEmailForWebsite('https://x.com', async () => { throw new Error('net') })).toBe('')
  })
})
