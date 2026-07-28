/**
 * One-off repair: removes rows duplicated across (or within) the given tabs,
 * keeping the first occurrence in tab order. Identity matches the exporter:
 * placeId from the mapsUrl !19s segment, falling back to name|address.
 *
 * Usage: npx tsx scripts/dedupe-tabs.ts <spreadsheetId> <tab> [<tab> …] [--dry-run]
 */
import { SheetsAuth } from '../src/sheets/auth.js'
import { SheetsClient } from '../src/sheets/client.js'
import { placeIdFromUrl } from '../src/scraper/listingParser.js'
import { fallbackIdentity } from '../src/sheets/exporter.js'

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== '--dry-run')
  const dryRun = process.argv.includes('--dry-run')
  const [spreadsheetId, ...tabTitles] = args
  if (!spreadsheetId || !tabTitles.length) {
    console.error('usage: npx tsx scripts/dedupe-tabs.ts <spreadsheetId> <tab> [...] [--dry-run]')
    process.exit(1)
  }

  const client = new SheetsClient(new SheetsAuth())
  const tabs = await client.getTabs(spreadsheetId)

  const seen = new Map<string, string>() // identity -> tab that keeps it
  const toDelete: { title: string; sheetId: number; rows: number[] }[] = []

  for (const title of tabTitles) {
    const tab = tabs.find((t) => t.title === title)
    if (!tab) throw new Error(`Tab "${title}" not found`)
    const values = await client.getValues(spreadsheetId, `'${title}'!A1:AG50000`)
    const header = values[0] ?? []
    const idx = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase())
    const mapsUrlCol = idx('mapsUrl')
    const nameCol = idx('name')
    const addressCol = idx('address')

    const dupes: number[] = []
    values.slice(1).forEach((row, i) => {
      if (!(row[nameCol >= 0 ? nameCol : 0] ?? '').trim()) return
      // A row can be known under two identities (placeId and normalised
      // name|address); a later row matching EITHER is a duplicate.
      const ids: string[] = []
      const pid = placeIdFromUrl(row[mapsUrlCol] ?? '')
      if (pid) ids.push(pid)
      ids.push(fallbackIdentity(row[nameCol] ?? '', row[addressCol] ?? ''))
      const holder = ids.map((id) => seen.get(id)).find(Boolean)
      if (holder) {
        dupes.push(i + 2) // 1-based sheet row
        console.log(`  ${title} row ${i + 2}: "${row[nameCol]}" already in ${holder}`)
      } else {
        for (const id of ids) seen.set(id, title)
      }
    })
    toDelete.push({ title, sheetId: tab.sheetId, rows: dupes })
  }

  const total = toDelete.reduce((a, t) => a + t.rows.length, 0)
  console.log(`\n${total} duplicate rows found across ${tabTitles.join(', ')}`)
  if (dryRun) { console.log('dry run — nothing deleted'); return }
  if (!total) return

  for (const t of toDelete) {
    if (!t.rows.length) continue
    // Delete bottom-up so earlier deletions don't shift later row numbers.
    const requests = [...t.rows].sort((a, b) => b - a).map((row) => ({
      deleteDimension: {
        range: { sheetId: t.sheetId, dimension: 'ROWS', startIndex: row - 1, endIndex: row },
      },
    }))
    await client.batchUpdate(spreadsheetId, requests)
    console.log(`${t.title}: deleted ${t.rows.length} rows`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
