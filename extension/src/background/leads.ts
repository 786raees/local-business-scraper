import { cellRange } from '../sheets/client'
import { buildMapping, columnLetter, rowToLead } from '../sheets/mapping'
import type { HeaderMapping } from '../sheets/mapping'
import type { DialFilter, Lead } from '../shared/types'

/**
 * Lead loading (ARCHITECTURE §5.4): header row via mapping, then paged reads
 * until a short page. Pure over an injected reader so vitest drives it
 * without Chrome or the network.
 */

export const PAGE_SIZE = 1000

interface ValuesReader {
  getValues(spreadsheetId: string, range: string): Promise<string[][]>
}

export interface LeadsResult {
  mapping: HeaderMapping
  /** Every data row, in sheet order. rowIndex (1-based) is the identity. */
  leads: Lead[]
  skippedNoPhone: number
}

export async function loadLeads(
  reader: ValuesReader,
  spreadsheetId: string,
  tabTitle: string,
  onProgress?: (count: number) => void,
): Promise<LeadsResult> {
  const headerRows = await reader.getValues(spreadsheetId, cellRange(tabTitle, '1:1'))
  const mapping = buildMapping(headerRows[0] ?? [])
  const lastCol = columnLetter(mapping.width - 1)

  const leads: Lead[] = []
  let start = 2
  for (;;) {
    const range = cellRange(tabTitle, `A${start}:${lastCol}${start + PAGE_SIZE - 1}`)
    const rows = await reader.getValues(spreadsheetId, range)
    rows.forEach((row, i) => leads.push(rowToLead(row, start + i, mapping)))
    onProgress?.(leads.length)
    if (rows.length < PAGE_SIZE) break
    start += PAGE_SIZE
  }

  return {
    mapping,
    leads,
    skippedNoPhone: leads.filter((l) => !l.phone).length,
  }
}

/**
 * Filter predicates (UX S3.5). A lead with no phone is never dialable.
 * `uncalled` and `retry` both exclude DNC by construction: DNC is a logged
 * status, so it is neither empty nor in the retry set.
 */
export function matchesFilter(lead: Lead, filter: DialFilter): boolean {
  if (!lead.phone) return false
  switch (filter) {
    case 'all':
      return true
    case 'uncalled':
      return !lead.callStatus
    case 'retry':
      return lead.callStatus === 'No Answer' || lead.callStatus === 'Callback'
  }
}

export function dialableLeads(leads: Lead[], filter: DialFilter): Lead[] {
  return leads.filter((l) => matchesFilter(l, filter))
}

/**
 * Cursor for "start from row N" (UX S3.4): the position of the first dialable
 * lead at-or-after that sheet row, so a non-dialable target row lands on the
 * next callable one. null when no dialable lead remains at/after the row.
 */
export function findCursorForRow(dialable: Lead[], rowIndex: number): number | null {
  const i = dialable.findIndex((l) => l.rowIndex >= rowIndex)
  return i === -1 ? null : i
}

/**
 * Keep the cursor pointing at the SAME next-to-dial business when the
 * dialable list changes shape. Under a narrow filter (e.g. `uncalled`), a
 * completed write removes the just-called lead from the list, shifting every
 * later index down by one — an unadjusted cursor then skips a lead on resume.
 */
export function reanchorCursor(
  dialableBefore: Lead[],
  dialableAfter: Lead[],
  cursor: number,
): number {
  const target = dialableBefore[cursor]
  if (!target) return Math.min(cursor, dialableAfter.length)
  const i = dialableAfter.findIndex((l) => l.rowIndex >= target.rowIndex)
  return i === -1 ? dialableAfter.length : i
}

const normName = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()

export interface LeadSearchResult {
  matches: Lead[]
  /** How many further matches were cut by the cap ("N more…"). */
  more: number
}

/**
 * Start-from picker search (story 12): name substring by default; an
 * all-digits query also matches by sheet row (exact or prefix), so the old
 * row-number fast path needs no separate mode.
 */
export function searchLeads(dialable: Lead[], query: string, cap = 50): LeadSearchResult {
  const q = normName(query)
  const all = !q
    ? dialable
    : /^\d+$/.test(q)
      ? dialable.filter((l) => String(l.rowIndex) === q || String(l.rowIndex).startsWith(q))
      : dialable.filter((l) => normName(l.name).includes(q))
  return { matches: all.slice(0, cap), more: Math.max(0, all.length - cap) }
}

/** Jump shortcut: where fresh work starts. */
export function firstUncalledCursor(dialable: Lead[]): number | null {
  const i = dialable.findIndex((l) => !l.callStatus)
  return i === -1 ? null : i
}

/**
 * Jump shortcut: the lead after the last one with any logged status —
 * "continue where the sheet's work ends", robust even when the resume point
 * is stale. No statuses at all → top; last lead already called → null.
 */
export function afterLastCalledCursor(dialable: Lead[]): number | null {
  let last = -1
  dialable.forEach((l, i) => { if (l.callStatus) last = i })
  if (last === -1) return 0
  return last + 1 < dialable.length ? last + 1 : null
}

/**
 * After "Reload leads" (UX §4.1): the sheet was re-sorted, so row numbers are
 * meaningless — re-find the in-progress business by NAME in the fresh list.
 */
export function findCursorByName(dialable: Lead[], name: string): number | null {
  const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()
  const target = norm(name)
  if (!target) return null
  const i = dialable.findIndex((l) => norm(l.name) === target)
  return i === -1 ? null : i
}
