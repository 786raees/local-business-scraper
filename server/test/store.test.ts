import { describe, it, expect } from 'vitest'
import { ResultsStore } from '../src/db/store.js'
import { emptyBusiness } from '../src/types.js'

function biz(name: string, extra: Partial<ReturnType<typeof emptyBusiness>> = {}) {
  return { ...emptyBusiness('kw', 'loc'), name, ...extra }
}

describe('ResultsStore', () => {
  it('inserts and counts rows', () => {
    const s = new ResultsStore(':memory:')
    s.insert(biz('Acme'))
    s.insert(biz('Beta'))
    expect(s.count()).toBe(2)
  })

  it('paginates in insertion order', () => {
    const s = new ResultsStore(':memory:')
    for (let i = 0; i < 25; i++) s.insert(biz(`Biz ${i}`))
    const page = s.queryPage(10, 5)
    expect(page).toHaveLength(5)
    expect(page[0].name).toBe('Biz 10')
    expect(page[4].name).toBe('Biz 14')
  })

  it('filters by text across fields', () => {
    const s = new ResultsStore(':memory:')
    s.insert(biz('Joe Plumbing', { category: 'Plumber' }))
    s.insert(biz('City Cafe', { category: 'Coffee shop' }))
    expect(s.count('plumb')).toBe(1)
    expect(s.queryPage(0, 10, 'coffee')[0].name).toBe('City Cafe')
  })

  it('reset clears all rows', () => {
    const s = new ResultsStore(':memory:')
    s.insert(biz('X')); s.reset()
    expect(s.count()).toBe(0)
  })

  it('iterateAll streams every row in batches', () => {
    const s = new ResultsStore(':memory:')
    for (let i = 0; i < 2500; i++) s.insert(biz(`B${i}`))
    let total = 0
    for (const batch of s.iterateAll(1000)) total += batch.length
    expect(total).toBe(2500)
  })
})
