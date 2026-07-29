import { describe, expect, it } from 'vitest'
import {
  PAGE_SIZE,
  afterLastCalledCursor,
  dialableLeads,
  findCursorForRow,
  firstUncalledCursor,
  loadLeads,
  matchesFilter,
  reanchorCursor,
  searchLeads,
} from '../src/background/leads'
import type { Lead } from '../src/shared/types'

const HEADERS = ['name', 'Stage', 'Call Status', 'Notes', 'phone']

/** Fake reader: header row + N data rows served in PAGE_SIZE pages. */
function readerFor(dataRows: string[][], ranges: string[] = []) {
  return {
    async getValues(_id: string, range: string): Promise<string[][]> {
      ranges.push(range)
      if (range.includes('!1:1')) return [HEADERS]
      const m = /!A(\d+):/.exec(range)
      const start = Number(m![1])
      return dataRows.slice(start - 2, start - 2 + PAGE_SIZE)
    },
  }
}

const row = (name: string, phone = '', callStatus = ''): string[] =>
  [name, '', callStatus, '', phone]

describe('loadLeads pagination', () => {
  it('loads a multi-page tab fully with correct rowIndex identity', async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => row(`Biz ${i}`, `+1 555-${i}`))
    const progress: number[] = []
    const result = await loadLeads(readerFor(rows), 'sid', 'Leads', (n) => progress.push(n))

    expect(result.leads).toHaveLength(2500)
    expect(result.leads[0].rowIndex).toBe(2) // row 2 = first data row
    expect(result.leads[2499].rowIndex).toBe(2501)
    expect(result.leads[2499].name).toBe('Biz 2499')
    expect(progress).toEqual([1000, 2000, 2500]) // 3 pages, streaming counts
  })

  it('stops on a short page and counts empty-phone rows', async () => {
    const rows = [row('A', '+1'), row('NoPhone'), row('B', '+2')]
    const result = await loadLeads(readerFor(rows), 'sid', 'Leads')
    expect(result.leads).toHaveLength(3)
    expect(result.skippedNoPhone).toBe(1)
  })

  it('reads ranges sized to the mapped header width', async () => {
    const ranges: string[] = []
    await loadLeads(readerFor([row('A', '+1')], ranges), 'sid', 'My Leads')
    expect(ranges[0]).toBe("'My Leads'!1:1")
    expect(ranges[1]).toBe(`'My Leads'!A2:E${2 + PAGE_SIZE - 1}`) // 5 headers → E
  })

  it('throws the mapping error for a non-Atlas tab', async () => {
    const reader = { async getValues() { return [['foo', 'bar']] } }
    await expect(loadLeads(reader, 'sid', 'Junk'))
      .rejects.toThrow('missing required headers')
  })
})

describe('start-from picker helpers (story 12)', () => {
  const mk = (rowIndex: number, name: string, callStatus?: string): Lead =>
    ({ rowIndex, name, phone: '+1', callStatus })
  const LIST: Lead[] = [
    mk(2, 'Acme Plumbing', 'Answered'),
    mk(5, 'Big Sky Dental', 'No Answer'),
    mk(9, 'Hilltop Vet Clinic'),
    mk(14, 'Hillside Bakery'),
    mk(20, 'Riverside Cafe'),
  ]

  describe('searchLeads', () => {
    it('matches by name substring, case/whitespace-insensitively', () => {
      expect(searchLeads(LIST, 'hill').matches.map((l) => l.name))
        .toEqual(['Hilltop Vet Clinic', 'Hillside Bakery'])
      expect(searchLeads(LIST, '  BIG  sky ').matches.map((l) => l.name))
        .toEqual(['Big Sky Dental'])
    })

    it('digit queries match sheet rows (exact and prefix) with no separate mode', () => {
      expect(searchLeads(LIST, '14').matches.map((l) => l.rowIndex)).toEqual([14])
      expect(searchLeads(LIST, '2').matches.map((l) => l.rowIndex)).toEqual([2, 20])
    })

    it('empty query returns the whole list; the cap yields a "more" count', () => {
      expect(searchLeads(LIST, '').matches).toHaveLength(5)
      const capped = searchLeads(LIST, 'e', 2) // matches several names
      expect(capped.matches).toHaveLength(2)
      expect(capped.more).toBeGreaterThan(0)
    })

    it('no matches → empty, never a throw', () => {
      expect(searchLeads(LIST, 'zzz').matches).toEqual([])
      expect(searchLeads([], 'a').matches).toEqual([])
    })
  })

  describe('jump shortcuts', () => {
    it('firstUncalledCursor finds where fresh work starts', () => {
      expect(firstUncalledCursor(LIST)).toBe(2) // Hilltop
      expect(firstUncalledCursor([mk(2, 'A', 'DNC')])).toBeNull()
      expect(firstUncalledCursor([])).toBeNull()
    })

    it('afterLastCalledCursor continues where the logged work ends', () => {
      expect(afterLastCalledCursor(LIST)).toBe(2) // after Big Sky (idx 1)
      const scattered = [mk(2, 'A', 'Answered'), mk(3, 'B'), mk(4, 'C', 'DNC'), mk(5, 'D')]
      expect(afterLastCalledCursor(scattered)).toBe(3) // after C, even with a gap at B
      expect(afterLastCalledCursor([mk(2, 'A'), mk(3, 'B')])).toBe(0) // nothing called → top
      expect(afterLastCalledCursor([mk(2, 'A', 'DNC')])).toBeNull() // last already called
    })
  })
})

describe('dial filters', () => {
  const lead = (phone: string, callStatus?: string): Lead =>
    ({ rowIndex: 2, name: 'x', phone, callStatus })

  it('never dials a lead without a phone, whatever the filter', () => {
    expect(matchesFilter(lead(''), 'all')).toBe(false)
    expect(matchesFilter(lead('', 'No Answer'), 'retry')).toBe(false)
  })

  it('uncalled = empty Call Status only (DNC rows excluded by construction)', () => {
    expect(matchesFilter(lead('+1'), 'uncalled')).toBe(true)
    expect(matchesFilter(lead('+1', 'DNC'), 'uncalled')).toBe(false)
    expect(matchesFilter(lead('+1', 'Answered'), 'uncalled')).toBe(false)
  })

  it('retry = No Answer or Callback only', () => {
    expect(matchesFilter(lead('+1', 'No Answer'), 'retry')).toBe(true)
    expect(matchesFilter(lead('+1', 'Callback'), 'retry')).toBe(true)
    expect(matchesFilter(lead('+1', 'DNC'), 'retry')).toBe(false)
    expect(matchesFilter(lead('+1'), 'retry')).toBe(false)
  })

  it('finds the start-from cursor at or after a sheet row', () => {
    const dialable: Lead[] = [
      { rowIndex: 2, name: 'a', phone: '+1' },
      { rowIndex: 10, name: 'b', phone: '+2' },
      { rowIndex: 30, name: 'c', phone: '+3' },
    ]
    expect(findCursorForRow(dialable, 2)).toBe(0)
    expect(findCursorForRow(dialable, 10)).toBe(1)
    expect(findCursorForRow(dialable, 11)).toBe(2) // non-dialable row → next callable
    expect(findCursorForRow(dialable, 31)).toBeNull()
  })

  it('reanchorCursor: a completed write must not skip the next lead (pause/resume bug)', () => {
    const mk = (rowIndex: number, name: string, callStatus?: string): Lead =>
      ({ rowIndex, name, phone: '+1', callStatus })
    // Uncalled list [A,B,C]; A was dialed (cursor advanced to 1 → next = B).
    const A = mk(2, 'A'), B = mk(3, 'B'), C = mk(4, 'C')
    const before = [A, B, C]
    // The write lands: A gains a status and drops out of the uncalled list.
    const after = [B, C]
    // Unadjusted cursor 1 would point at C — B skipped. Re-anchored: still B.
    expect(reanchorCursor(before, after, 1)).toBe(0)
    expect(after[reanchorCursor(before, after, 1)].name).toBe('B')
    // 'all' filter: list unchanged → cursor unchanged.
    expect(reanchorCursor(before, before, 1)).toBe(1)
    // Last lead written at end of list → cursor lands past the end (atEnd).
    expect(reanchorCursor([C], [], 1)).toBe(0)
    expect(reanchorCursor([B, C], [B], 1)).toBe(1)
  })

  it('counts a mixed fixture correctly per filter', () => {
    const leads = [
      lead('+1'), lead('+2', 'No Answer'), lead('+3', 'DNC'),
      lead('+4', 'Callback'), lead(''), lead('+5', 'Interested'),
    ]
    expect(dialableLeads(leads, 'all')).toHaveLength(5)
    expect(dialableLeads(leads, 'uncalled')).toHaveLength(1)
    expect(dialableLeads(leads, 'retry')).toHaveLength(2)
  })
})
