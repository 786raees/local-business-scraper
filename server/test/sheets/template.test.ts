import { describe, it, expect } from 'vitest'
import {
  RESERVED_HEADERS, CHANNELS, STAGE_VALUES, TEMPLATE_HEADERS,
  CRM_HEADERS, OUTREACH_FORMULA, buildTemplateRequests,
} from '../../src/sheets/sheetTemplate.js'
import { ALL_COLUMNS } from '../../src/export/csv.js'

describe('template headers', () => {
  it('starts with name then the nine CRM columns', () => {
    expect(TEMPLATE_HEADERS.slice(0, 10)).toEqual([
      'name', 'Stage', 'Call Status', 'SMS Status', 'FB Status', 'IG Status', 'LI Status',
      'Outreach', 'Priority', 'Notes',
    ])
  })

  it('contains every Atlas column exactly once', () => {
    for (const col of ALL_COLUMNS) {
      expect(TEMPLATE_HEADERS.filter((h) => h === col)).toHaveLength(1)
    }
  })

  it('is 35 columns wide: name + 9 CRM + the other 25 Atlas fields', () => {
    expect(TEMPLATE_HEADERS).toHaveLength(ALL_COLUMNS.length + CRM_HEADERS.length)
    expect(TEMPLATE_HEADERS).toHaveLength(35)
  })

  it('never uses a channel name that collides with an Atlas URL field', () => {
    const lower = ALL_COLUMNS.map((c) => String(c).toLowerCase())
    for (const ch of CHANNELS) {
      expect(lower).not.toContain(ch.header.toLowerCase())
    }
  })
})

describe('reserved headers', () => {
  it('covers all nine CRM columns', () => {
    expect(RESERVED_HEADERS).toHaveLength(9)
    expect(RESERVED_HEADERS).toContain('Outreach')
    expect(RESERVED_HEADERS).toContain('Stage')
  })
})

describe('channels', () => {
  it('defines five channels', () => {
    expect(CHANNELS.map((c) => c.header)).toEqual([
      'Call Status', 'SMS Status', 'FB Status', 'IG Status', 'LI Status',
    ])
  })
  it('gives every channel a non-empty vocabulary', () => {
    for (const c of CHANNELS) expect(c.values.length).toBeGreaterThan(0)
  })
})

describe('stage vocabulary', () => {
  it('starts at New and includes both closed states', () => {
    expect(STAGE_VALUES[0]).toBe('New')
    expect(STAGE_VALUES).toContain('Closed-Won')
    expect(STAGE_VALUES).toContain('Closed-Lost')
  })
})

describe('OUTREACH_FORMULA', () => {
  it('is an ARRAYFORMULA covering the whole column', () => {
    expect(OUTREACH_FORMULA.startsWith('=ARRAYFORMULA(')).toBe(true)
  })
  it('references all five channel columns C through G', () => {
    for (const col of ['C2:C', 'D2:D', 'E2:E', 'F2:F', 'G2:G']) {
      expect(OUTREACH_FORMULA).toContain(col)
    }
  })
})

describe('buildTemplateRequests', () => {
  const reqs = buildTemplateRequests(42) as Record<string, any>[]

  it('freezes the header row and the name column', () => {
    const frozen = reqs.find((r) => r.updateSheetProperties)
    expect(frozen.updateSheetProperties.properties.gridProperties).toMatchObject({
      frozenRowCount: 1, frozenColumnCount: 1,
    })
  })

  it('creates one dropdown per channel plus Stage and Priority', () => {
    const dv = reqs.filter((r) => r.setDataValidation)
    expect(dv).toHaveLength(CHANNELS.length + 2)
  })

  it('adds exactly four channel colour rules over the C:G block', () => {
    const channelRules = reqs
      .filter((r) => r.addConditionalFormatRule)
      .map((r) => r.addConditionalFormatRule.rule)
      .filter((rule: any) => rule.ranges[0].startColumnIndex === 2 && rule.ranges[0].endColumnIndex === 7)
    expect(channelRules).toHaveLength(4)
    for (const rule of channelRules) {
      expect(rule.booleanRule.condition.type).toBe('CUSTOM_FORMULA')
    }
  })

  it('targets the sheet id it was given', () => {
    for (const r of reqs) {
      const target = r.updateSheetProperties?.properties?.sheetId
        ?? r.setDataValidation?.range?.sheetId
        ?? r.repeatCell?.range?.sheetId
        ?? r.addConditionalFormatRule?.rule?.ranges?.[0]?.sheetId
        ?? r.updateDimensionProperties?.range?.sheetId
      if (target !== undefined) expect(target).toBe(42)
    }
  })
})
