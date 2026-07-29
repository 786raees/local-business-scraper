import { describe, expect, it } from 'vitest'
import {
  applyWriteToLead,
  namesMatch,
  notesAppend,
  outcomeCells,
} from '../src/background/outcomes'
import { buildMapping } from '../src/sheets/mapping'
import type { Lead } from '../src/shared/types'

describe('outcomeCells', () => {
  it('resolves cells from the header mapping, never position', () => {
    // Reordered tab: Call Status in E, name in C, Notes missing.
    const mapping = buildMapping(['id', 'phone', 'name', 'Stage', 'Call Status'])
    expect(outcomeCells(mapping, 42)).toEqual({
      nameCell: 'C42',
      callStatusCell: 'E42',
      notesCell: null,
    })
  })

  it('handles the canonical 33-column template (Call Status = C, Notes = J)', () => {
    const mapping = buildMapping([
      'name', 'Stage', 'Call Status', 'SMS Status', 'FB Status', 'IG Status', 'LI Status',
      'Outreach', 'Priority', 'Notes', 'ownerName', 'ownerTitle', 'address', 'phone',
    ])
    const cells = outcomeCells(mapping, 7)
    expect(cells).toEqual({ nameCell: 'A7', callStatusCell: 'C7', notesCell: 'J7' })
  })
})

describe('notesAppend', () => {
  it('date-prefixes and appends after existing content', () => {
    expect(notesAppend('left VM last week', 'wants a demo', '2026-07-29T15:00:00Z'))
      .toBe('left VM last week\n2026-07-29: wants a demo')
  })

  it('starts clean on an empty cell', () => {
    expect(notesAppend('', 'callback friday', '2026-07-29T15:00:00Z'))
      .toBe('2026-07-29: callback friday')
    expect(notesAppend('   ', 'x', '2026-07-29T15:00:00Z')).toBe('2026-07-29: x')
  })
})

describe('namesMatch — the stale-row guard', () => {
  it('tolerates whitespace and case drift only', () => {
    expect(namesMatch('Big Sky Dental', ' big  sky dental ')).toBe(true)
    expect(namesMatch('Big Sky Dental', 'Hilltop Vet Clinic')).toBe(false)
    expect(namesMatch('Big Sky Dental', '')).toBe(false)
  })
})

describe('applyWriteToLead', () => {
  const lead: Lead = { rowIndex: 5, name: 'Acme', phone: '+1', callStatus: 'No Answer', notes: 'old' }

  it('updates status and appends the note', () => {
    const next = applyWriteToLead(
      lead,
      { rowIndex: 5, leadName: 'Acme', outcome: 'Interested', note: 'demo tue' },
      '2026-07-29T15:00:00Z',
    )
    expect(next.callStatus).toBe('Interested')
    expect(next.notes).toBe('old\n2026-07-29: demo tue')
    expect(lead.callStatus).toBe('No Answer') // immutably
  })

  it('leaves notes untouched without a note', () => {
    const next = applyWriteToLead(
      lead,
      { rowIndex: 5, leadName: 'Acme', outcome: 'DNC' },
      '2026-07-29T15:00:00Z',
    )
    expect(next.notes).toBe('old')
  })
})
