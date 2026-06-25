import { Business } from '../types.js'

export const ALL_COLUMNS: (keyof Business)[] = [
  'name', 'ownerName', 'ownerTitle', 'address', 'phone', 'website', 'email',
  'rating', 'reviewCount', 'priceLevel', 'category', 'hours',
  'facebook', 'instagram', 'twitter', 'linkedin', 'youtube', 'tiktok', 'yelp', 'yellowpages',
  'ownerSource', 'mapsUrl', 'keyword', 'location',
]

function cell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** Header line (no trailing newline). */
export function csvHeaderLine(columns: (keyof Business)[] = ALL_COLUMNS): string {
  return columns.join(',')
}

/** Body lines for a batch of rows (each row newline-terminated). */
export function csvRows(rows: Business[], columns: (keyof Business)[] = ALL_COLUMNS): string {
  if (!rows.length) return ''
  return rows.map((r) => columns.map((c) => cell(r[c])).join(',')).join('\n') + '\n'
}

/** Whole-document CSV (header + body). Used by tests and small exports. */
export function toCsv(rows: Business[], columns: (keyof Business)[] = ALL_COLUMNS): string {
  return csvHeaderLine(columns) + '\n' + csvRows(rows, columns)
}
