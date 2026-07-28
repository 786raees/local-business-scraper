/**
 * One-off migration: converts a legacy Atlas lead tab (name, Status, Priority, Notes,
 * + 23 Atlas fields) to the five-channel model defined in sheetTemplate.ts.
 *
 * Usage: npx tsx scripts/migrate-sheet.ts <spreadsheetId> <tabTitle> [--dry-run]
 *
 * --restyle re-applies the template (styling, dropdowns, colour rules, Outreach
 * formula) to an already-migrated tab without touching any values. Use it after
 * changing sheetTemplate.ts.
 */
import { SheetsAuth } from '../src/sheets/auth.js'
import { SheetsClient } from '../src/sheets/client.js'
import {
  TEMPLATE_HEADERS, CRM_HEADERS, buildOutreachFormula, buildTemplateRequests,
  clearConditionalFormatRequests,
} from '../src/sheets/sheetTemplate.js'
import { columnLetter, buildHeaderMap } from '../src/sheets/mapping.js'

/** Legacy single Status value -> new Stage + Call Status pair. */
export function migrateLegacyStatus(status: string): { stage: string; call: string } {
  switch (status.trim()) {
    case 'Called-No Answer':  return { stage: 'Contacted', call: 'No Answer' }
    case 'Called-VM':         return { stage: 'Contacted', call: 'Voicemail' }
    case 'Called-Interested': return { stage: 'Interested', call: 'Interested' }
    case 'Demo Booked':       return { stage: 'Demo Booked', call: '' }
    case 'Trial Active':      return { stage: 'Trial Active', call: '' }
    case 'Closed-Won':        return { stage: 'Closed-Won', call: '' }
    case 'Closed-Lost':       return { stage: 'Closed-Lost', call: '' }
    case 'Not Interested':    return { stage: 'Not Interested', call: 'Not Interested' }
    case 'DNC':               return { stage: 'DNC', call: 'DNC' }
    default:                  return { stage: 'New', call: '' }
  }
}

/**
 * Reapply styling to an already-migrated tab without touching values.
 * Stale conditional-format rules are deleted first — applying the template on top of
 * existing rules otherwise leaves old ones pointing at repurposed columns.
 */
async function restyle(
  client: SheetsClient, spreadsheetId: string, tabTitle: string, sheetId: number,
): Promise<void> {
  const existingRules = await client.conditionalFormatCount(spreadsheetId, sheetId)
  await client.batchUpdate(spreadsheetId, [
    ...clearConditionalFormatRequests(sheetId, existingRules),
    ...buildTemplateRequests(sheetId),
  ])
  const map = buildHeaderMap(TEMPLATE_HEADERS)
  const col = columnLetter(map.outreachIndex)
  const letters = map.channelIndexes.map((i) => (i >= 0 ? columnLetter(i) : ''))
  await client.clearValues(spreadsheetId, `'${tabTitle}'!${col}2:${col}`)
  await client.updateValues(spreadsheetId, `'${tabTitle}'!${col}2`, [[buildOutreachFormula(letters)]])
  const after = await client.conditionalFormatCount(spreadsheetId, sheetId)
  console.log(`${tabTitle}: restyled — cleared ${existingRules} stale rules, now ${after}`)
}

async function main(): Promise<void> {
  const [spreadsheetId, tabTitle] = process.argv.slice(2)
  const dryRun = process.argv.includes('--dry-run')
  if (!spreadsheetId || !tabTitle) {
    console.error('usage: npx tsx scripts/migrate-sheet.ts <spreadsheetId> <tabTitle> [--dry-run]')
    process.exit(1)
  }

  const client = new SheetsClient(new SheetsAuth())
  const tabs = await client.getTabs(spreadsheetId)
  const tab = tabs.find((t) => t.title === tabTitle)
  if (!tab) throw new Error(`Tab "${tabTitle}" not found`)

  const rows = await client.getValues(spreadsheetId, `'${tabTitle}'!A1:BZ`)
  const header = rows[0] ?? []
  const body = rows.slice(1)
  const idx = (name: string) => header.findIndex((h) => h.trim().toLowerCase() === name.toLowerCase())

  if (process.argv.includes('--restyle')) {
    await restyle(client, spreadsheetId, tabTitle, tab.sheetId)
    return
  }

  const statusCol = idx('Status')
  const priorityCol = idx('Priority')
  const notesCol = idx('Notes')
  if (statusCol < 0) throw new Error('No legacy "Status" column found — already migrated?')

  // Legacy Atlas columns, i.e. everything that is not a legacy CRM column.
  const legacyAtlas = header
    .map((h, i) => ({ h: h.trim(), i }))
    .filter(({ h }) => !['Status', 'Priority', 'Notes'].includes(h))

  const migrated = body
    .filter((r) => (r[0] ?? '').trim())
    .map((r) => {
      const out: string[] = new Array(TEMPLATE_HEADERS.length).fill('')
      const { stage, call } = migrateLegacyStatus(r[statusCol] ?? '')
      out[TEMPLATE_HEADERS.indexOf('Stage')] = stage
      out[TEMPLATE_HEADERS.indexOf('Call Status')] = call
      out[TEMPLATE_HEADERS.indexOf('Priority')] = priorityCol >= 0 ? r[priorityCol] ?? '' : ''
      out[TEMPLATE_HEADERS.indexOf('Notes')] = notesCol >= 0 ? r[notesCol] ?? '' : ''
      for (const { h, i } of legacyAtlas) {
        const target = TEMPLATE_HEADERS.indexOf(h)
        if (target >= 0) out[target] = r[i] ?? ''
      }
      return out
    })

  const stageCounts: Record<string, number> = {}
  const callCounts: Record<string, number> = {}
  const stageIdx = TEMPLATE_HEADERS.indexOf('Stage')
  const callIdx = TEMPLATE_HEADERS.indexOf('Call Status')
  for (const r of migrated) {
    stageCounts[r[stageIdx]] = (stageCounts[r[stageIdx]] ?? 0) + 1
    if (r[callIdx]) callCounts[r[callIdx]] = (callCounts[r[callIdx]] ?? 0) + 1
  }

  console.log(`${tabTitle}: ${body.length} source rows -> ${migrated.length} rows x ${TEMPLATE_HEADERS.length} columns`)
  console.log('  legacy header width:', header.length)
  console.log('  Stage distribution:', JSON.stringify(stageCounts))
  console.log('  Call Status distribution:', JSON.stringify(callCounts))
  const preserved = migrated.filter((r) => r[TEMPLATE_HEADERS.indexOf('Notes')] || r[TEMPLATE_HEADERS.indexOf('Priority')]).length
  console.log(`  rows with Priority or Notes preserved: ${preserved}`)
  console.log('  sample row (first 12 cols):', JSON.stringify(migrated[0]?.slice(0, 12)))

  if (dryRun) { console.log('\ndry run — nothing written'); return }

  // Widen the grid, then rewrite header + body, then restyle.
  if (tab.rowCount < migrated.length + 1) {
    console.log('  growing grid rows')
  }
  await client.batchUpdate(spreadsheetId, [{
    updateSheetProperties: {
      properties: { sheetId: tab.sheetId, gridProperties: { columnCount: TEMPLATE_HEADERS.length } },
      fields: 'gridProperties.columnCount',
    },
  }])
  await client.updateValues(spreadsheetId, `'${tabTitle}'!A1`, [TEMPLATE_HEADERS])
  if (migrated.length) {
    await client.updateValues(spreadsheetId, `'${tabTitle}'!A2`, migrated)
  }
  // Strip pre-existing rules first, or the template's rules are appended to stale
  // ones that now point at repurposed columns.
  const existingRules = await client.conditionalFormatCount(spreadsheetId, tab.sheetId)
  await client.batchUpdate(spreadsheetId, [
    ...clearConditionalFormatRequests(tab.sheetId, existingRules),
    ...buildTemplateRequests(tab.sheetId),
  ])
  console.log(`  cleared ${existingRules} pre-existing conditional-format rules`)

  // Outreach formula last, and only after clearing — cells written as "" are
  // occupied and would make the ARRAYFORMULA fail with #REF!.
  const map = buildHeaderMap(TEMPLATE_HEADERS)
  const col = columnLetter(map.outreachIndex)
  const letters = map.channelIndexes.map((i) => (i >= 0 ? columnLetter(i) : ''))
  await client.clearValues(spreadsheetId, `'${tabTitle}'!${col}2:${col}`)
  await client.updateValues(spreadsheetId, `'${tabTitle}'!${col}2`, [[buildOutreachFormula(letters)]])

  console.log(`\nmigrated ${tabTitle} (${CRM_HEADERS.length} CRM columns installed)`)
}

// Only run when invoked directly, so the test can import migrateLegacyStatus.
if (process.argv[1]?.includes('migrate-sheet')) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
