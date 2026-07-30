import { cellRange } from '../sheets/client'
import { buildMapping, columnLetter, rowToLead } from '../sheets/mapping'
import type { HeaderMapping } from '../sheets/mapping'
import { CALL_STATUS_VALUES } from '../sheets/vocab'
import { LINE_TYPE_FILTERS, opText } from '../shared/criteria'
import type {
  BlankExclusions,
  DialCriteria,
  DialFilter,
  Lead,
  LineTypeFilter,
  NumberFilter,
} from '../shared/types'

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
 * The single dial-criteria evaluator (story 14): AND across axes, OR within a
 * multi-select axis. A lead with no phone is never dialable. `uncalled` and
 * `retry` both exclude DNC by construction: DNC is a logged status, so it is
 * neither empty nor in the retry set.
 */
function matchesStatus(lead: Lead, status: DialFilter): boolean {
  switch (status) {
    case 'all':
      return true
    case 'uncalled':
      return !lead.callStatus
    case 'retry':
      return lead.callStatus === 'No Answer' || lead.callStatus === 'Callback'
  }
}

/** Blank or unrecognised line values both read as 'unknown' — mirrors Atlas's store filter. */
function leadLineKind(lead: Lead): LineTypeFilter {
  const t = (lead.lineType ?? '').trim().toLowerCase()
  return LINE_TYPE_FILTERS.includes(t as LineTypeFilter) && t !== 'unknown'
    ? (t as LineTypeFilter)
    : 'unknown'
}

/** Sheet cells are strings; NaN counts as blank, never 0 (story 14 decision 5). */
function numValue(s?: string): number | null {
  const t = (s ?? '').trim().replace(/,/g, '')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

const cmp = (n: number, f: NumberFilter): boolean =>
  f.op === 'lt' ? n < f.value : n >= f.value

/**
 * lenientBlanks lets excludedBlankCounts ask "would this lead match if its
 * blank values were ignored?" — the caption that separates "filtered" from
 * "sheet has no data" (story 14 decision 3).
 */
function matches(lead: Lead, c: DialCriteria, lenientBlanks: boolean): boolean {
  if (!lead.phone) return false
  if (!matchesStatus(lead, c.status)) return false
  if (c.outcomes?.length
    && !(lead.callStatus && (c.outcomes as string[]).includes(lead.callStatus))) return false
  if (c.stages?.length && !(lead.stage && c.stages.includes(lead.stage))) return false
  const site = (lead.website ?? '').trim()
  if (c.website === 'has' && !site) return false
  if (c.website === 'none' && site) return false
  if (c.lineTypes?.length) {
    const blank = !(lead.lineType ?? '').trim()
    if (!c.lineTypes.includes(leadLineKind(lead)) && !(lenientBlanks && blank)) return false
  }
  for (const [f, cell] of [
    [c.reviewCount, lead.reviewCount],
    [c.rating, lead.rating],
  ] as const) {
    if (!f) continue
    const n = numValue(cell)
    if (n === null) {
      if (!lenientBlanks) return false
    } else if (!cmp(n, f)) {
      return false
    }
  }
  return true
}

export function matchesFilter(lead: Lead, criteria: DialCriteria): boolean {
  return matches(lead, criteria, false)
}

export function dialableLeads(leads: Lead[], criteria: DialCriteria): Lead[] {
  return leads.filter((l) => matchesFilter(l, criteria))
}

/**
 * How many leads are excluded ONLY because a filtered value is blank in the
 * sheet — they'd match with that blank ignored. Powers the "12 leads have no
 * rating and are excluded" caption so blank data never silently disappears.
 */
export function excludedBlankCounts(leads: Lead[], c: DialCriteria): BlankExclusions {
  const out: BlankExclusions = { rating: 0, reviewCount: 0, lineType: 0 }
  const lineSensitive = !!c.lineTypes?.length && !c.lineTypes.includes('unknown')
  if (!c.rating && !c.reviewCount && !lineSensitive) return out
  for (const l of leads) {
    if (matches(l, c, false) || !matches(l, c, true)) continue
    if (c.rating && numValue(l.rating) === null) out.rating++
    if (c.reviewCount && numValue(l.reviewCount) === null) out.reviewCount++
    if (lineSensitive && !(l.lineType ?? '').trim()) out.lineType++
  }
  return out
}

/**
 * Names the first criterion that excludes a lead — the picker's zero-match
 * explainer ("Acme is filtered out — line type is landline"). null = it matches.
 */
export function explainExclusion(lead: Lead, c: DialCriteria): string | null {
  if (matchesFilter(lead, c)) return null
  if (!lead.phone) return 'no phone number'
  if (!matchesStatus(lead, c.status)) {
    return c.status === 'uncalled'
      ? `already logged: ${lead.callStatus}`
      : `Call Status is ${lead.callStatus || 'empty'}, filter retries No Answer/Callback`
  }
  if (c.outcomes?.length
    && !(lead.callStatus && (c.outcomes as string[]).includes(lead.callStatus))) {
    return lead.callStatus ? `Call Status is ${lead.callStatus}` : 'no Call Status logged'
  }
  if (c.stages?.length && !(lead.stage && c.stages.includes(lead.stage))) {
    return lead.stage ? `Stage is ${lead.stage}` : 'no Stage set'
  }
  const site = (lead.website ?? '').trim()
  if (c.website === 'has' && !site) return 'no website'
  if (c.website === 'none' && site) return 'has a website'
  if (c.lineTypes?.length && !c.lineTypes.includes(leadLineKind(lead))) {
    const blank = !(lead.lineType ?? '').trim()
    return blank ? 'line type unknown' : `line type is ${leadLineKind(lead)}`
  }
  const reviews = numValue(lead.reviewCount)
  if (c.reviewCount && (reviews === null || !cmp(reviews, c.reviewCount))) {
    return reviews === null
      ? 'no review count in the sheet'
      : `${reviews} reviews, filter wants ${opText(c.reviewCount)}`
  }
  const rating = numValue(lead.rating)
  if (c.rating && (rating === null || !cmp(rating, c.rating))) {
    return rating === null
      ? 'no rating in the sheet'
      : `rating ${rating}, filter wants ${opText(c.rating)}`
  }
  return 'filtered out'
}

/**
 * Stage/Outcome checklist options: the canonical vocabulary plus whatever the
 * tab actually contains (story 14 decision 4 — CRM-customised sheets filter too).
 */
export function tabVocab(leads: Lead[]): { stages: string[]; outcomes: string[] } {
  const stages = new Set<string>()
  const extraOutcomes = new Set<string>()
  for (const l of leads) {
    if (l.stage?.trim()) stages.add(l.stage.trim())
    const status = l.callStatus?.trim()
    if (status && !(CALL_STATUS_VALUES as readonly string[]).includes(status)) {
      extraOutcomes.add(status)
    }
  }
  return {
    stages: [...stages].sort((a, b) => a.localeCompare(b)),
    outcomes: [...CALL_STATUS_VALUES, ...[...extraOutcomes].sort((a, b) => a.localeCompare(b))],
  }
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
