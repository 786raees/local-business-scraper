import type { Lead } from '../shared/types'

/**
 * Header-name → column resolution (ARCHITECTURE §5.3). Columns are matched by
 * header name, never by position — a user may have reordered or inserted
 * columns and a tab's layout must survive that (Atlas rule).
 */

/** Headers a tab must have to be dialable at all. */
export const REQUIRED_HEADERS = ['name', 'phone', 'Call Status'] as const

/** Optional Lead fields picked up when their header is present. */
const OPTIONAL_FIELD_HEADERS: Record<string, keyof Lead> = {
  'ownername': 'ownerName',
  'ownertitle': 'ownerTitle',
  'category': 'category',
  'address': 'address',
  'website': 'website',
  'rating': 'rating',
  'reviewcount': 'reviewCount',
  'stage': 'stage',
  'notes': 'notes',
  'linetype': 'lineType',
  'linecarrier': 'lineCarrier',
}

export interface HeaderMapping {
  /** 0-based column index per resolved Lead field. */
  columns: Partial<Record<keyof Lead, number>>
  nameCol: number
  phoneCol: number
  callStatusCol: number
  notesCol: number | null
  /** Total header width, for building read ranges. */
  width: number
}

export interface TabValidation {
  ok: boolean
  missing: string[]
}

const norm = (h: string) => h.trim().toLowerCase()

function indexHeaders(headerRow: string[]): Map<string, number> {
  const map = new Map<string, number>()
  headerRow.forEach((h, i) => {
    const key = norm(h)
    // First occurrence wins, matching a case-insensitive lookup's behaviour.
    if (key && !map.has(key)) map.set(key, i)
  })
  return map
}

/** Why a tab can't be used, by header name — powers the disabled-tab hint (UX S2). */
export function validateTab(headerRow: string[]): TabValidation {
  const index = indexHeaders(headerRow)
  const missing = REQUIRED_HEADERS.filter((h) => !index.has(norm(h)))
  return { ok: missing.length === 0, missing: [...missing] }
}

/** Resolve a validated header row into a full mapping. Throws if invalid. */
export function buildMapping(headerRow: string[]): HeaderMapping {
  const validation = validateTab(headerRow)
  if (!validation.ok) {
    throw new Error(`Tab is missing required headers: ${validation.missing.join(', ')}`)
  }
  const index = indexHeaders(headerRow)
  const columns: Partial<Record<keyof Lead, number>> = {
    name: index.get('name'),
    phone: index.get('phone'),
    callStatus: index.get('call status'),
  }
  for (const [header, field] of Object.entries(OPTIONAL_FIELD_HEADERS)) {
    const col = index.get(header)
    if (col !== undefined) columns[field] = col
  }
  return {
    columns,
    nameCol: index.get('name')!,
    phoneCol: index.get('phone')!,
    callStatusCol: index.get('call status')!,
    notesCol: index.get('notes') ?? null,
    width: headerRow.length,
  }
}

/** 0-based column index → A1 letters, incl. beyond Z (Atlas tabs are 35 columns wide). */
export function columnLetter(index: number): string {
  let n = index
  let letters = ''
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return letters
}

/** Build a Lead from a data row. rowIndex is the 1-based sheet row (identity). */
export function rowToLead(row: string[], rowIndex: number, mapping: HeaderMapping): Lead {
  const cell = (field: keyof Lead): string | undefined => {
    const col = mapping.columns[field]
    if (col === undefined) return undefined
    const value = row[col]?.trim()
    return value || undefined
  }
  return {
    rowIndex,
    name: cell('name') ?? '',
    phone: cell('phone') ?? '',
    ownerName: cell('ownerName'),
    ownerTitle: cell('ownerTitle'),
    category: cell('category'),
    address: cell('address'),
    website: cell('website'),
    rating: cell('rating'),
    reviewCount: cell('reviewCount'),
    stage: cell('stage'),
    callStatus: cell('callStatus'),
    notes: cell('notes'),
    lineType: cell('lineType'),
    lineCarrier: cell('lineCarrier'),
  }
}
