import { describe, it, expect } from 'vitest'
import { toCsv } from '../src/export/csv.js'
import { emptyBusiness } from '../src/types.js'

describe('toCsv', () => {
  it('writes header and quotes fields with commas', () => {
    const b = emptyBusiness('plumber', 'Miami')
    b.name = 'Acme, Inc'
    b.phone = '305-555-1212'
    const csv = toCsv([b], ['name', 'phone'])
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe('name,phone')
    expect(lines[1]).toBe('"Acme, Inc",305-555-1212')
  })
  it('escapes quotes by doubling', () => {
    const b = emptyBusiness('k', 'l'); b.name = 'A "B" C'
    expect(toCsv([b], ['name']).trim().split('\n')[1]).toBe('"A ""B"" C"')
  })
})
