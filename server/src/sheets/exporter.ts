import { Business, ExportResult } from '../types.js'
import { SheetsClient } from './client.js'
import { buildHeaderMap, businessToRow, columnLetter, HeaderMap } from './mapping.js'
import { TEMPLATE_HEADERS, buildTemplateRequests, OUTREACH_FORMULA } from './sheetTemplate.js'
import { placeIdFromUrl } from '../scraper/listingParser.js'

/** Sheets caps a spreadsheet at 10M cells; append degrades well before that. */
export const MAX_EXPORT_ROWS = 50000

/** Rows per append request. Large enough to be few calls, small enough to stay bounded. */
const APPEND_BATCH = 5000

export class ExportError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'ExportError'
  }
}

export interface ExportOptions {
  spreadsheetId: string
  sheetTitle: string
  createNew?: boolean
}

export interface ExporterDeps {
  client: SheetsClient
  iterate: (batch: number) => Generator<Business[]>
  count: () => number
  maxRows?: number
}

/** Identity for dedup: placeId, matching ResultsStore.insert. */
function identity(b: Business): string {
  return placeIdFromUrl(b.mapsUrl) || `${b.name}|${b.address}`.toLowerCase()
}

function existingIdentities(rows: string[][], map: HeaderMap): Set<string> {
  const seen = new Set<string>()
  for (const row of rows) {
    if (map.mapsUrlIndex >= 0) {
      const id = placeIdFromUrl(row[map.mapsUrlIndex] ?? '')
      if (id) { seen.add(id); continue }
    }
    // Fall back to name+address when the tab has no mapsUrl column, or the cell is blank.
    const name = map.nameIndex >= 0 ? row[map.nameIndex] ?? '' : ''
    const address = map.addressIndex >= 0 ? row[map.addressIndex] ?? '' : ''
    if (name || address) seen.add(`${name}|${address}`.toLowerCase())
  }
  return seen
}

/** Turn a bare/empty tab into a fully styled Atlas lead tab. */
async function buildTab(
  client: SheetsClient, spreadsheetId: string, sheetTitle: string, sheetId: number,
): Promise<string[]> {
  await client.updateValues(spreadsheetId, `'${sheetTitle}'!A1`, [TEMPLATE_HEADERS])
  await client.batchUpdate(spreadsheetId, buildTemplateRequests(sheetId))
  // USER_ENTERED (inside updateValues) so this lands as a formula, not literal text.
  const outreachCol = columnLetter(TEMPLATE_HEADERS.indexOf('Outreach'))
  await client.updateValues(spreadsheetId, `'${sheetTitle}'!${outreachCol}2`, [[OUTREACH_FORMULA]])
  return TEMPLATE_HEADERS
}

export async function exportToSheet(deps: ExporterDeps, opts: ExportOptions): Promise<ExportResult> {
  const client = deps.client
  const spreadsheetId = opts.spreadsheetId
  const cap = deps.maxRows ?? MAX_EXPORT_ROWS
  const total = deps.count()

  // Check the cap before any write, so we never leave a half-populated sheet.
  if (total > cap) {
    throw new ExportError(
      `${total.toLocaleString()} rows exceeds the Google Sheets export limit of ` +
      `${cap.toLocaleString()}. Use Export CSV instead.`,
      413,
    )
  }

  const tabs = await client.getTabs(spreadsheetId)
  let tab = tabs.find((t) => t.title === opts.sheetTitle)

  if (!tab) {
    if (!opts.createNew) {
      throw new ExportError(`Tab "${opts.sheetTitle}" not found in the spreadsheet.`, 404)
    }
    const res = await client.batchUpdate(spreadsheetId, [{
      addSheet: {
        properties: {
          title: opts.sheetTitle,
          gridProperties: { rowCount: 1000, columnCount: TEMPLATE_HEADERS.length },
        },
      },
    }])
    const created = res.replies[0] as { addSheet?: { properties?: { sheetId?: number } } }
    tab = { sheetId: created.addSheet?.properties?.sheetId ?? 0, title: opts.sheetTitle, rowCount: 1000 }
  }

  const existing = await client.getValues(spreadsheetId, `'${opts.sheetTitle}'!A1:BZ`)
  let headerRow = existing[0] ?? []

  // An empty tab (or one with no header) gets the full styled structure.
  if (headerRow.filter((h) => h.trim()).length === 0) {
    headerRow = await buildTab(client, spreadsheetId, opts.sheetTitle, tab.sheetId)
  }

  const map = buildHeaderMap(headerRow)
  const seen = existingIdentities(existing.slice(1), map)

  let appended = 0
  let skipped = 0
  let buffer: string[][] = []

  const flush = async () => {
    if (!buffer.length) return
    await client.appendValues(spreadsheetId, `'${opts.sheetTitle}'!A1`, buffer)
    appended += buffer.length
    buffer = []
  }

  // Stream from SQLite so the full result set is never held in memory.
  for (const batch of deps.iterate(1000)) {
    for (const b of batch) {
      const id = identity(b)
      if (seen.has(id)) { skipped++; continue }
      seen.add(id)
      buffer.push(businessToRow(b, map))
      if (buffer.length >= APPEND_BATCH) await flush()
    }
  }
  await flush()

  return { appended, skipped, total }
}
