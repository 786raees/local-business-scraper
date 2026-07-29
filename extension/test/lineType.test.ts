import { describe, expect, it } from 'vitest'
import { LINE_TYPE_CAVEAT, lineTypeStyle, lineTypeTooltip } from '../src/shared/lineType'

describe('lineTypeStyle', () => {
  it('maps the three recognised values, tolerant of case/whitespace', () => {
    expect(lineTypeStyle('mobile')).toEqual({ label: 'Mobile', kind: 'mobile' })
    expect(lineTypeStyle('landline')).toEqual({ label: 'Landline', kind: 'landline' })
    expect(lineTypeStyle(' VoIP ')).toEqual({ label: 'VoIP', kind: 'voip' })
  })

  it('renders nothing for unknown, blank, absent, or future values', () => {
    expect(lineTypeStyle('unknown')).toBeNull()
    expect(lineTypeStyle('')).toBeNull()
    expect(lineTypeStyle(undefined)).toBeNull()
    expect(lineTypeStyle('satellite')).toBeNull() // forward-compatible: no broken chip
  })
})

describe('lineTypeTooltip', () => {
  it('always carries the porting caveat, with the carrier when present', () => {
    expect(lineTypeTooltip('Bandwidth.com CLEC')).toBe(`Bandwidth.com CLEC — ${LINE_TYPE_CAVEAT}`)
    expect(lineTypeTooltip('')).toBe(LINE_TYPE_CAVEAT)
    expect(lineTypeTooltip(undefined)).toBe(LINE_TYPE_CAVEAT)
  })
})
