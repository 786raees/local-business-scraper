import { describe, expect, it } from 'vitest'
import {
  dialableLeads,
  excludedBlankCounts,
  explainExclusion,
  matchesFilter,
  reanchorCursor,
  tabVocab,
} from '../src/background/leads'
import {
  DEFAULT_CRITERIA,
  criteriaSummary,
  sanitizeCriteria,
} from '../src/shared/criteria'
import { normalizeStoredSettings, DEFAULT_SETTINGS } from '../src/shared/storage'
import type { DialCriteria, Lead } from '../src/shared/types'

const lead = (over: Partial<Lead> = {}): Lead =>
  ({ rowIndex: 2, name: 'Acme', phone: '+1', ...over })

describe('matchesFilter — each axis alone (story 14)', () => {
  it('never matches a lead without a phone, whatever the criteria', () => {
    expect(matchesFilter(lead({ phone: '' }), { status: 'all' })).toBe(false)
    expect(matchesFilter(lead({ phone: '', callStatus: 'No Answer' }), { status: 'retry' }))
      .toBe(false)
  })

  it('status axis behaves exactly as the v1 filter', () => {
    expect(matchesFilter(lead(), { status: 'uncalled' })).toBe(true)
    expect(matchesFilter(lead({ callStatus: 'DNC' }), { status: 'uncalled' })).toBe(false)
    expect(matchesFilter(lead({ callStatus: 'No Answer' }), { status: 'retry' })).toBe(true)
    expect(matchesFilter(lead({ callStatus: 'Callback' }), { status: 'retry' })).toBe(true)
    expect(matchesFilter(lead(), { status: 'retry' })).toBe(false)
    expect(matchesFilter(lead({ callStatus: 'DNC' }), { status: 'all' })).toBe(true)
  })

  it('lineTypes: OR within the axis; unknown matches blank AND unrecognised values', () => {
    const c: DialCriteria = { status: 'all', lineTypes: ['mobile', 'voip'] }
    expect(matchesFilter(lead({ lineType: 'mobile' }), c)).toBe(true)
    expect(matchesFilter(lead({ lineType: 'voip' }), c)).toBe(true)
    expect(matchesFilter(lead({ lineType: 'landline' }), c)).toBe(false)
    expect(matchesFilter(lead(), c)).toBe(false)
    const unk: DialCriteria = { status: 'all', lineTypes: ['unknown'] }
    expect(matchesFilter(lead(), unk)).toBe(true) // absent
    expect(matchesFilter(lead({ lineType: '' }), unk)).toBe(true) // blank
    expect(matchesFilter(lead({ lineType: 'unknown' }), unk)).toBe(true)
    expect(matchesFilter(lead({ lineType: 'satellite' }), unk)).toBe(true) // future value
    expect(matchesFilter(lead({ lineType: 'mobile' }), unk)).toBe(false)
  })

  it('website tri-state; whitespace-only cells count as no website', () => {
    expect(matchesFilter(lead({ website: 'https://a.com' }), { status: 'all', website: 'has' }))
      .toBe(true)
    expect(matchesFilter(lead(), { status: 'all', website: 'has' })).toBe(false)
    expect(matchesFilter(lead({ website: '  ' }), { status: 'all', website: 'has' })).toBe(false)
    expect(matchesFilter(lead(), { status: 'all', website: 'none' })).toBe(true)
    expect(matchesFilter(lead({ website: 'https://a.com' }), { status: 'all', website: 'none' }))
      .toBe(false)
  })

  it('reviewCount lt/gte; blank and NaN cells never match an active filter', () => {
    const under20: DialCriteria = { status: 'all', reviewCount: { op: 'lt', value: 20 } }
    expect(matchesFilter(lead({ reviewCount: '12' }), under20)).toBe(true)
    expect(matchesFilter(lead({ reviewCount: '20' }), under20)).toBe(false)
    expect(matchesFilter(lead({ reviewCount: '1,024' }), under20)).toBe(false) // comma parse
    expect(matchesFilter(lead(), under20)).toBe(false) // blank ≠ 0 (decision 5)
    expect(matchesFilter(lead({ reviewCount: 'n/a' }), under20)).toBe(false) // NaN = blank
    const over: DialCriteria = { status: 'all', reviewCount: { op: 'gte', value: 20 } }
    expect(matchesFilter(lead({ reviewCount: '20' }), over)).toBe(true)
  })

  it('rating lt/gte with the same blank semantics', () => {
    const c: DialCriteria = { status: 'all', rating: { op: 'gte', value: 4 } }
    expect(matchesFilter(lead({ rating: '4.6' }), c)).toBe(true)
    expect(matchesFilter(lead({ rating: '3.9' }), c)).toBe(false)
    expect(matchesFilter(lead(), c)).toBe(false)
  })

  it('stages and outcomes match only present values', () => {
    expect(matchesFilter(lead({ stage: 'New' }), { status: 'all', stages: ['New'] })).toBe(true)
    expect(matchesFilter(lead(), { status: 'all', stages: ['New'] })).toBe(false)
    expect(matchesFilter(
      lead({ callStatus: 'No Answer' }), { status: 'all', outcomes: ['No Answer'] })).toBe(true)
    expect(matchesFilter(lead(), { status: 'all', outcomes: ['No Answer'] })).toBe(false)
  })
})

describe('matchesFilter — combined axes (AND across, OR within)', () => {
  const c: DialCriteria = {
    status: 'uncalled',
    lineTypes: ['mobile'],
    website: 'none',
    reviewCount: { op: 'lt', value: 20 },
  }

  it('a lead must pass every active axis', () => {
    const match = lead({ lineType: 'mobile', reviewCount: '5' })
    expect(matchesFilter(match, c)).toBe(true)
    expect(matchesFilter({ ...match, callStatus: 'Answered' }, c)).toBe(false)
    expect(matchesFilter({ ...match, lineType: 'landline' }, c)).toBe(false)
    expect(matchesFilter({ ...match, website: 'https://a.com' }, c)).toBe(false)
    expect(matchesFilter({ ...match, reviewCount: '99' }, c)).toBe(false)
  })

  it('dialableLeads counts a mixed fixture correctly', () => {
    const leads = [
      lead({ rowIndex: 2, lineType: 'mobile', reviewCount: '5' }),
      lead({ rowIndex: 3, lineType: 'mobile', reviewCount: '5', callStatus: 'DNC' }),
      lead({ rowIndex: 4, lineType: 'voip', reviewCount: '5' }),
      lead({ rowIndex: 5, lineType: 'mobile' }), // blank reviews → excluded
    ]
    expect(dialableLeads(leads, c).map((l) => l.rowIndex)).toEqual([2])
    expect(dialableLeads(leads, { status: 'all' })).toHaveLength(4)
  })
})

describe('excludedBlankCounts — "filtered" vs "sheet has no data" (decision 3)', () => {
  it('counts leads excluded ONLY by a blank value under an active filter', () => {
    const leads = [
      lead({ rowIndex: 2, rating: '4.5' }), // matches
      lead({ rowIndex: 3 }), // blank rating → counted
      lead({ rowIndex: 4, rating: '3.0' }), // fails on the value, not blank
      lead({ rowIndex: 5, callStatus: 'DNC' }), // fails status too — not counted
    ]
    const c: DialCriteria = { status: 'uncalled', rating: { op: 'gte', value: 4 } }
    expect(excludedBlankCounts(leads, c)).toEqual({ rating: 1, reviewCount: 0, lineType: 0 })
  })

  it('line-type blanks count only when unknown is NOT selected', () => {
    const leads = [lead({ rowIndex: 2 }), lead({ rowIndex: 3, lineType: 'mobile' })]
    expect(excludedBlankCounts(leads, { status: 'all', lineTypes: ['mobile'] }).lineType).toBe(1)
    expect(excludedBlankCounts(
      leads, { status: 'all', lineTypes: ['mobile', 'unknown'] }).lineType).toBe(0)
  })

  it('returns zeros with no blank-sensitive axis active', () => {
    expect(excludedBlankCounts([lead()], { status: 'uncalled', website: 'has' }))
      .toEqual({ rating: 0, reviewCount: 0, lineType: 0 })
  })
})

describe('explainExclusion — the picker explainer names the failing criterion', () => {
  it('null for a matching lead; first failing axis otherwise', () => {
    expect(explainExclusion(lead(), DEFAULT_CRITERIA)).toBeNull()
    expect(explainExclusion(lead({ callStatus: 'Answered' }), DEFAULT_CRITERIA))
      .toBe('already logged: Answered')
    expect(explainExclusion(lead({ lineType: 'landline' }),
      { status: 'all', lineTypes: ['mobile'] })).toBe('line type is landline')
    expect(explainExclusion(lead(), { status: 'all', lineTypes: ['mobile'] }))
      .toBe('line type unknown')
    expect(explainExclusion(lead({ website: 'https://a.com' }),
      { status: 'all', website: 'none' })).toBe('has a website')
    expect(explainExclusion(lead({ reviewCount: '99' }),
      { status: 'all', reviewCount: { op: 'lt', value: 20 } }))
      .toBe('99 reviews, filter wants < 20')
    expect(explainExclusion(lead(),
      { status: 'all', rating: { op: 'gte', value: 4 } }))
      .toBe('no rating in the sheet')
    expect(explainExclusion(lead({ phone: '' }), { status: 'all' })).toBe('no phone number')
  })
})

describe('tabVocab — sheet-derived checklist options (decision 4)', () => {
  it('stages come from the tab; outcomes are canonical plus tab extras', () => {
    const leads = [
      lead({ stage: 'New' }),
      lead({ stage: 'Custom Stage' }),
      lead({ callStatus: 'Left Message' }), // CRM-customised status
      lead({ callStatus: 'No Answer' }),
    ]
    const v = tabVocab(leads)
    expect(v.stages).toEqual(['Custom Stage', 'New'])
    expect(v.outcomes[0]).toBe('No Answer') // canonical order preserved
    expect(v.outcomes).toContain('Left Message')
    expect(v.outcomes.filter((o) => o === 'No Answer')).toHaveLength(1)
  })
})

describe('sanitizeCriteria', () => {
  it('drops malformed axes and collapses empty multi-selects to "any"', () => {
    expect(sanitizeCriteria(undefined)).toEqual({ status: 'uncalled' })
    expect(sanitizeCriteria({ status: 'bogus', lineTypes: ['mobile', 'satellite'] }))
      .toEqual({ status: 'uncalled', lineTypes: ['mobile'] })
    expect(sanitizeCriteria({ status: 'all', lineTypes: [], stages: [], outcomes: [] }))
      .toEqual({ status: 'all' })
    expect(sanitizeCriteria({ status: 'all', outcomes: ['DNC', 'Nonsense'] }))
      .toEqual({ status: 'all', outcomes: ['DNC'] })
  })

  it('clamps numeric filters to sane bounds', () => {
    expect(sanitizeCriteria({ status: 'all', rating: { op: 'gte', value: 99 } }).rating)
      .toEqual({ op: 'gte', value: 5 })
    expect(sanitizeCriteria({ status: 'all', reviewCount: { op: 'lt', value: -5 } }).reviewCount)
      .toEqual({ op: 'lt', value: 0 })
    expect(sanitizeCriteria({ status: 'all', rating: { op: 'lt', value: NaN } }).rating)
      .toBeUndefined()
  })
})

describe('criteriaSummary', () => {
  it('reads as the collapsed one-liner', () => {
    expect(criteriaSummary({ status: 'uncalled' })).toBe('Uncalled')
    expect(criteriaSummary({
      status: 'uncalled',
      lineTypes: ['mobile'],
      website: 'none',
      reviewCount: { op: 'lt', value: 20 },
    })).toBe('Uncalled · Mobile · No website · Reviews < 20')
  })
})

describe('settings migration (story 14 decision 2)', () => {
  it('lifts a legacy dialFilter string into criteria — no user-visible reset', () => {
    const s = normalizeStoredSettings({ interCallDelayMs: 5000, dialFilter: 'retry' })
    expect(s.dialCriteria).toEqual({ status: 'retry' })
    expect(s.interCallDelayMs).toBe(5000)
  })

  it('stored criteria win over a stale legacy value; absent both → default', () => {
    const s = normalizeStoredSettings({
      dialFilter: 'all',
      dialCriteria: { status: 'retry', lineTypes: ['voip'] },
    })
    expect(s.dialCriteria).toEqual({ status: 'retry', lineTypes: ['voip'] })
    expect(normalizeStoredSettings(undefined)).toEqual(DEFAULT_SETTINGS)
  })
})

describe('mid-session criteria change re-anchoring (extends the pause/resume fix)', () => {
  it('narrowing the criteria keeps the cursor on the same next business', () => {
    const A = lead({ rowIndex: 2, name: 'A', lineType: 'landline' })
    const B = lead({ rowIndex: 3, name: 'B', lineType: 'mobile' })
    const C = lead({ rowIndex: 4, name: 'C', lineType: 'mobile' })
    const before = dialableLeads([A, B, C], { status: 'all' })
    // Cursor on B (index 1); user switches to mobile-only → A drops out.
    const after = dialableLeads([A, B, C], { status: 'all', lineTypes: ['mobile'] })
    const cursor = reanchorCursor(before, after, 1)
    expect(after[cursor].name).toBe('B')
    // Current lead itself filtered out → lands on the next match, not past it.
    const voipOnly = dialableLeads([A, B, C], { status: 'all', lineTypes: ['voip'] })
    expect(reanchorCursor(before, voipOnly, 1)).toBe(0)
  })
})
