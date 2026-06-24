import { describe, it, expect } from 'vitest'
import { emptyBusiness } from '../src/types.js'

describe('emptyBusiness', () => {
  it('seeds keyword and location, nulls numeric fields', () => {
    const b = emptyBusiness('plumber', 'Miami, FL')
    expect(b.keyword).toBe('plumber')
    expect(b.location).toBe('Miami, FL')
    expect(b.rating).toBeNull()
    expect(b.name).toBe('')
  })
})
