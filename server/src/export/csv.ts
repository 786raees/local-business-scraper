import { Business } from '../types.js'

const ALL: (keyof Business)[] = [
  'name', 'address', 'phone', 'website', 'rating', 'reviewCount', 'priceLevel',
  'category', 'hours', 'email', 'mapsUrl', 'keyword', 'location',
]

function cell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: Business[], columns: (keyof Business)[] = ALL): string {
  const header = columns.join(',')
  const body = rows.map((r) => columns.map((c) => cell(r[c])).join(',')).join('\n')
  return header + '\n' + body + '\n'
}
