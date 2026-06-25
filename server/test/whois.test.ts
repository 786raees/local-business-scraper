import { describe, it, expect } from 'vitest'
import { registrantName, whoisOwner } from '../src/scraper/whois.js'

const rdapWith = (fn: string) => ({
  entities: [{ roles: ['registrant'], vcardArray: ['vcard', [['version', {}, 'text', '4.0'], ['fn', {}, 'text', fn]]] }],
})

describe('registrantName', () => {
  it('extracts the registrant full name', () => {
    expect(registrantName(rdapWith('Jane Doe'))).toBe('Jane Doe')
  })
  it('ignores redacted/privacy values', () => {
    expect(registrantName(rdapWith('REDACTED FOR PRIVACY'))).toBe('')
    expect(registrantName(rdapWith('Domains By Proxy, LLC'))).toBe('')
  })
  it('returns empty when no registrant entity', () => {
    expect(registrantName({ entities: [{ roles: ['technical'], vcardArray: ['vcard', []] }] })).toBe('')
  })
})

describe('whoisOwner', () => {
  it('returns the registrant name for a website domain', async () => {
    const fake = async () => rdapWith('Acme Holdings Inc')
    expect(await whoisOwner('https://acme-unit-test-xyz.com/contact', fake)).toBe('Acme Holdings Inc')
  })
  it('returns empty for an invalid url', async () => {
    expect(await whoisOwner('not a url', async () => ({}))).toBe('')
  })
})
