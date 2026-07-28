import { Business } from '../types.js'
import { ALL_COLUMNS } from '../export/csv.js'
import { RESERVED_HEADERS, CHANNELS } from './sheetTemplate.js'
import { cleanText } from '../scraper/listingParser.js'

export interface HeaderMap {
  /** Number of columns in the target tab's header row. */
  width: number
  /** Per column: the Business field to write there, or null to leave alone. */
  fields: (keyof Business | null)[]
  stageIndex: number
  outreachIndex: number
  mapsUrlIndex: number
  nameIndex: number
  addressIndex: number
  /** Column index of each CHANNELS entry, in CHANNELS order; -1 when absent. */
  channelIndexes: number[]
}

/** 0 -> A, 25 -> Z, 26 -> AA. */
export function columnLetter(index: number): string {
  let n = index
  let out = ''
  do {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return out
}

const norm = (s: string) => s.trim().toLowerCase()

const ATLAS_BY_NAME = new Map<string, keyof Business>(
  ALL_COLUMNS.map((c) => [norm(String(c)), c]),
)
const RESERVED = new Set(RESERVED_HEADERS.map(norm))

/**
 * Resolve the target tab's header row to Business fields by NAME, never by position,
 * so a tab with extra or reordered columns still works.
 *
 * Reserved CRM headers win over any Atlas match: "FB Status" must never be treated as
 * the `facebook` URL field, and the reserved set is checked first for that reason.
 */
export function buildHeaderMap(headerRow: string[]): HeaderMap {
  const fields = headerRow.map((h) => {
    const key = norm(h)
    if (RESERVED.has(key)) return null
    return ATLAS_BY_NAME.get(key) ?? null
  })
  const indexOfHeader = (name: string) => headerRow.findIndex((h) => norm(h) === norm(name))
  return {
    width: headerRow.length,
    fields,
    stageIndex: indexOfHeader('Stage'),
    outreachIndex: indexOfHeader('Outreach'),
    mapsUrlIndex: fields.indexOf('mapsUrl'),
    nameIndex: fields.indexOf('name'),
    addressIndex: fields.indexOf('address'),
    channelIndexes: CHANNELS.map((c) => indexOfHeader(c.header)),
  }
}

/** Build one sheet row for a business, at exactly the header's width. */
export function businessToRow(b: Business, map: HeaderMap): string[] {
  const row: string[] = new Array(map.width).fill('')
  map.fields.forEach((field, i) => {
    if (!field) return
    const v = b[field]
    row[i] = v === null || v === undefined ? '' : cleanText(String(v))
  })
  // New leads enter the pipeline as New so they appear in the dashboard's New bucket.
  if (map.stageIndex >= 0) row[map.stageIndex] = 'New'
  // The Outreach column holds a whole-column ARRAYFORMULA — writing anything
  // non-empty into it would break the formula for every row.
  if (map.outreachIndex >= 0) row[map.outreachIndex] = ''
  return row
}
