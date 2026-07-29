/**
 * One-off: backfill lineType/lineCarrier columns on existing Google Sheets lead
 * tabs, classified offline from each row's phone (see src/phone/lineType.ts).
 *
 * Usage: npx tsx scripts/backfill-sheet-linetype.ts <tabTitle...> [--dry-run]
 *        npx tsx scripts/backfill-sheet-linetype.ts --sheet <spreadsheetId> <tabTitle...>
 *
 * Rules honoured (CLAUDE.md):
 * - Columns are found by header name, never position; missing headers are
 *   APPENDED via appendDimension (never columnCount, which can truncate).
 * - Only the two line columns are written, as column ranges, RAW — the
 *   Outreach ARRAYFORMULA and every other column are untouched.
 * - Existing non-blank line values are preserved (idempotent re-runs).
 */
import { SheetsAuth } from '../src/sheets/auth.js'
import { SheetsClient } from '../src/sheets/client.js'
import { columnLetter } from '../src/sheets/mapping.js'
import { classifyPhone } from '../src/phone/lineType.js'

const dryRun = process.argv.includes('--dry-run')
const args = process.argv.slice(2).filter((a) => a !== '--dry-run')

async function resolveSpreadsheet(client: SheetsClient): Promise<{ id: string; tabs: string[] }> {
  const sheetFlag = args.indexOf('--sheet')
  if (sheetFlag !== -1) {
    return { id: args[sheetFlag + 1], tabs: args.filter((_, i) => i !== sheetFlag && i !== sheetFlag + 1) }
  }
  const sheets = await client.listSpreadsheets()
  if (sheets.length !== 1) {
    throw new Error(
      `${sheets.length} spreadsheets are shared with the service account — pass --sheet <id>. ` +
      `Found: ${sheets.map((s) => `${s.name} (${s.id})`).join(', ')}`,
    )
  }
  console.log(`spreadsheet: ${sheets[0].name}`)
  return { id: sheets[0].id, tabs: args }
}

async function backfillTab(client: SheetsClient, spreadsheetId: string, tabTitle: string): Promise<void> {
  const tabs = await client.getTabs(spreadsheetId)
  const tab = tabs.find((t) => t.title === tabTitle)
  if (!tab) throw new Error(`Tab "${tabTitle}" not found`)

  const rows = await client.getValues(spreadsheetId, `'${tabTitle}'!A1:BZ`)
  const header = rows[0] ?? []
  const body = rows.slice(1)
  const idx = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase())

  const phoneCol = idx('phone')
  if (phoneCol < 0) throw new Error(`${tabTitle}: no "phone" column found`)

  let typeCol = idx('lineType')
  let carrierCol = idx('lineCarrier')
  const needHeaders = typeCol < 0 || carrierCol < 0

  // Classify every row; keep an existing non-blank value (idempotent).
  const histogram: Record<string, number> = {}
  let classified = 0
  const typeValues: string[][] = []
  const carrierValues: string[][] = []
  for (const r of body) {
    const existing = typeCol >= 0 ? (r[typeCol] ?? '').trim() : ''
    if (existing) {
      typeValues.push([existing])
      carrierValues.push([carrierCol >= 0 ? r[carrierCol] ?? '' : ''])
      continue
    }
    const info = classifyPhone(r[phoneCol] ?? '')
    typeValues.push([info.lineType])
    carrierValues.push([info.lineCarrier])
    histogram[info.lineType] = (histogram[info.lineType] ?? 0) + 1
    classified++
  }

  const parts = ['mobile', 'landline', 'voip', 'unknown']
    .filter((t) => histogram[t])
    .map((t) => `${histogram[t]} ${t}`)
  console.log(
    `${tabTitle}: ${body.length} rows, classifying ${classified}` +
    (parts.length ? ` (${parts.join(' · ')})` : '') +
    (needHeaders ? ' — adding lineType/lineCarrier headers' : ''),
  )
  if (dryRun) return

  if (needHeaders) {
    // Append two columns to whatever the grid has — appendDimension can never
    // truncate, unlike setting columnCount.
    await client.batchUpdate(spreadsheetId, [{
      appendDimension: { sheetId: tab.sheetId, dimension: 'COLUMNS', length: 2 },
    }])
    typeCol = header.length
    carrierCol = header.length + 1
    await client.updateValues(
      spreadsheetId,
      `'${tabTitle}'!${columnLetter(typeCol)}1`,
      [['lineType', 'lineCarrier']],
    )
  }

  if (body.length) {
    const tCol = columnLetter(typeCol)
    const cCol = columnLetter(carrierCol)
    await client.updateValues(
      spreadsheetId, `'${tabTitle}'!${tCol}2:${tCol}${body.length + 1}`, typeValues)
    await client.updateValues(
      spreadsheetId, `'${tabTitle}'!${cCol}2:${cCol}${body.length + 1}`, carrierValues)
  }
  console.log(`${tabTitle}: written (${columnLetter(typeCol)}/${columnLetter(carrierCol)})`)
}

async function main(): Promise<void> {
  const client = new SheetsClient(new SheetsAuth())
  const { id, tabs } = await resolveSpreadsheet(client)
  if (tabs.length === 0) {
    console.error('usage: npx tsx scripts/backfill-sheet-linetype.ts [--sheet <id>] <tabTitle...> [--dry-run]')
    process.exit(1)
  }
  for (const tab of tabs) await backfillTab(client, id, tab)
  if (dryRun) console.log('\ndry run — nothing written')
}

main().catch((e) => { console.error(e); process.exit(1) })
