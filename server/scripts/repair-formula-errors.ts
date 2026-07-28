/**
 * Repairs cells left as #ERROR! by a USER_ENTERED write of literal text — e.g. a phone
 * number "+1 305-697-3490", which Sheets tries to parse as a formula.
 *
 * The original string survives as the cell's userEnteredValue, so it can be read back
 * with valueRenderOption=FORMULA and rewritten with RAW. Nothing is lost.
 *
 * Usage: npx tsx scripts/repair-formula-errors.ts <spreadsheetId> <tabTitle> [--dry-run]
 */
import { SheetsAuth } from '../src/sheets/auth.js'
import { SheetsClient } from '../src/sheets/client.js'
import { columnLetter } from '../src/sheets/mapping.js'

const ERROR_CELL = /^#(ERROR!|REF!|NAME\?|VALUE!|DIV\/0!|N\/A|NUM!)/

async function main(): Promise<void> {
  const [spreadsheetId, tabTitle] = process.argv.slice(2)
  const dryRun = process.argv.includes('--dry-run')
  if (!spreadsheetId || !tabTitle) {
    console.error('usage: npx tsx scripts/repair-formula-errors.ts <spreadsheetId> <tabTitle> [--dry-run]')
    process.exit(1)
  }

  const auth = new SheetsAuth()
  const client = new SheetsClient(auth)
  const token = await auth.getToken()
  const range = `'${tabTitle}'!A1:AG1000`

  const rendered = await client.getValues(spreadsheetId, range)
  const raw = (await (await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueRenderOption=FORMULA`,
    { headers: { authorization: `Bearer ${token}` } },
  )).json() as { values?: string[][] }).values ?? []

  // Group broken cells by column so each column is one contiguous write.
  const byColumn = new Map<number, { row: number; value: string }[]>()
  let unrecoverable = 0
  rendered.forEach((row, r) => {
    if (r === 0) return // never touch the header
    row.forEach((cell, c) => {
      if (!ERROR_CELL.test(cell ?? '')) return
      const original = raw[r]?.[c] ?? ''
      if (!original || ERROR_CELL.test(original)) { unrecoverable++; return }
      if (!byColumn.has(c)) byColumn.set(c, [])
      byColumn.get(c)!.push({ row: r + 1, value: original })
    })
  })

  const totalBroken = [...byColumn.values()].reduce((n, v) => n + v.length, 0)
  console.log(`${tabTitle}: ${totalBroken} recoverable, ${unrecoverable} unrecoverable`)
  for (const [c, cells] of byColumn) {
    console.log(`  column ${columnLetter(c)}: ${cells.length} cells, e.g. ${JSON.stringify(cells[0].value)}`)
  }
  if (dryRun) { console.log('dry run — nothing written'); return }
  if (!totalBroken) { console.log('nothing to repair'); return }

  for (const [c, cells] of byColumn) {
    const col = columnLetter(c)
    const first = Math.min(...cells.map((x) => x.row))
    const last = Math.max(...cells.map((x) => x.row))
    // Rebuild the whole span, preserving cells that were never broken.
    const column: string[][] = []
    for (let r = first; r <= last; r++) {
      const fix = cells.find((x) => x.row === r)
      column.push([fix ? fix.value : (raw[r - 1]?.[c] ?? '')])
    }
    // RAW is the whole point: these are literal strings, not formulas.
    await client.updateValues(spreadsheetId, `'${tabTitle}'!${col}${first}:${col}${last}`, column, 'RAW')
    console.log(`  rewrote ${col}${first}:${col}${last} as RAW`)
  }

  const after = await client.getValues(spreadsheetId, range)
  const remaining = after.slice(1).flat().filter((c) => ERROR_CELL.test(c ?? '')).length
  console.log(`${tabTitle}: repaired — ${remaining} error cells remaining`)
}

main().catch((e) => { console.error(e); process.exit(1) })
