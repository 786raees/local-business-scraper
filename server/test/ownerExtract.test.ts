import { describe, it, expect } from 'vitest'
import { extractOwner } from '../src/scraper/ownerExtract.js'

describe('extractOwner', () => {
  it('finds "Owner: Name"', () => {
    expect(extractOwner('Contact us. Owner: Jane Doe. Call today.')).toEqual({ name: 'Jane Doe', title: 'Owner' })
  })
  it('finds "Name, Founder"', () => {
    expect(extractOwner('Meet John Smith, Founder of Acme Plumbing.')?.name).toBe('John Smith')
  })
  it('finds "owned by Name"', () => {
    expect(extractOwner('This family business is owned by Maria Garcia since 1998.')).toEqual({ name: 'Maria Garcia', title: 'Owner' })
  })
  it('returns null when no owner phrasing', () => {
    expect(extractOwner('We offer fast, reliable plumbing services in Miami.')).toBeNull()
  })
  it('does not treat a business name as a person', () => {
    expect(extractOwner('Owner operated. Acme Plumbing Services LLC.')).toBeNull()
  })
})
