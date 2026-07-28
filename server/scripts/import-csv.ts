/**
 * Imports a Bing-Maps-style leads CSV and splits it across sheet tabs by percentage,
 * deduplicating against rows already in ANY target tab (name|address identity) and
 * within the file itself.
 *
 * Usage: npx tsx scripts/import-csv.ts <csvPath> <spreadsheetId> <tab:percent> [<tab:percent> …] [--dry-run]
 * e.g.   npx tsx scripts/import-csv.ts leads.csv <id> Faizan:50 Amna:50
 */
import { readFileSync } from 'node:fs'
import { emptyBusiness, Business } from '../src/types.js'
import { cleanText } from '../src/scraper/listingParser.js'
import { SheetsAuth } from '../src/sheets/auth.js'
import { SheetsClient } from '../src/sheets/client.js'
import { exportSplit } from '../src/sheets/exporter.js'

/** Minimal RFC-4180 parser: quoted fields may contain commas, quotes, newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const src = text.replace(/^﻿/, '')
  for (let i = 0; i < src.length; i++) {
    const c = src[i]
    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += c
    } else if (c === '"') inQuotes = true
    else if (c === ',') { row.push(field); field = '' }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some((f) => f.trim())) rows.push(row)
      row = []
    } else field += c
  }
  row.push(field)
  if (row.some((f) => f.trim())) rows.push(row)
  return rows
}

/** First plausible outreach email — skips privacy/legal boilerplate addresses. */
function pickEmail(raw: string): string {
  return raw.split(/[,;\s]+/).filter(Boolean)
    .find((e) => !/privacy|ccpa|policy|abuse|legal/i.test(e)) ?? ''
}

function rowToBusiness(header: string[], row: string[], keyword: string): Business {
  const get = (name: string) => {
    const i = header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase())
    return i >= 0 ? cleanText(row[i] ?? '') : ''
  }
  const name = get('Name')
  const address = get('Address')
  const reviewMatch = get('Rating Info').match(/\((\d[\d,]*)\)/)
  const socials = get('Social Medias')
  const social = (frag: string) =>
    socials.split(',').map((s) => s.trim()).find((u) => u.toLowerCase().includes(frag)) ?? ''
  return {
    ...emptyBusiness(keyword, address.split(',').slice(-2).join(',').trim() || 'Miami, FL'),
    // No Google placeId exists for these; a synthetic unique one keeps the store/export
    // happy while dedup falls through to name|address.
    placeId: get('ID') || `csv:${name}|${address}`.toLowerCase(),
    name,
    address,
    phone: get('Phone'),
    website: get('Website'),
    email: pickEmail(get('Emails')),
    rating: get('Rating') ? Number(get('Rating')) : null,
    reviewCount: reviewMatch ? parseInt(reviewMatch[1].replace(/,/g, ''), 10) : null,
    category: get('Category'),
    hours: get('Open Hours'),
    mapsUrl: get('Bing Maps URL'),
    facebook: get('Facebook') || social('facebook.com'),
    instagram: get('Instagram') || social('instagram.com'),
    twitter: get('Twitter') || social('twitter.com') || social('x.com'),
    linkedin: social('linkedin.com'),
    youtube: social('youtube.com'),
  }
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run')
  const args = process.argv.slice(2).filter((a) => a !== '--dry-run')
  const [csvPath, spreadsheetId, ...targetArgs] = args
  if (!csvPath || !spreadsheetId || !targetArgs.length) {
    console.error('usage: npx tsx scripts/import-csv.ts <csvPath> <spreadsheetId> <tab:percent> [...] [--dry-run]')
    process.exit(1)
  }
  const targets = targetArgs.map((a) => {
    const [sheetTitle, pct] = a.split(':')
    return { sheetTitle, percent: Number(pct), createNew: false }
  })

  const rows = parseCsv(readFileSync(csvPath, 'utf8'))
  const [header, ...body] = rows
  const businesses: Business[] = []
  const seenInFile = new Set<string>()
  let inFileDupes = 0
  for (const r of body) {
    const b = rowToBusiness(header, r, 'plumber')
    if (!b.name) continue
    const key = `${b.name}|${b.address}`.toLowerCase()
    if (seenInFile.has(key)) { inFileDupes++; continue }
    seenInFile.add(key)
    businesses.push(b)
  }
  console.log(`${csvPath}: ${body.length} data rows -> ${businesses.length} unique (${inFileDupes} in-file dupes)`)
  console.log('sample:', JSON.stringify({ name: businesses[0]?.name, phone: businesses[0]?.phone, email: businesses[0]?.email }))
  if (dryRun) { console.log('dry run — nothing exported'); return }

  const client = new SheetsClient(new SheetsAuth())
  const res = await exportSplit(
    {
      client,
      count: () => businesses.length,
      iterate: function* (batch: number) {
        for (let i = 0; i < businesses.length; i += batch) yield businesses.slice(i, i + batch)
      },
    },
    { spreadsheetId, targets },
  )
  console.log('result:', JSON.stringify(res, null, 1))
}

if (process.argv[1]?.includes('import-csv')) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
