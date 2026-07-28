import { Business, ExportResult, ExportTarget, SplitExportResult, TabExportSummary } from '../types.js'
import { SheetsClient } from './client.js'
import { buildHeaderMap, businessToRow, columnLetter, HeaderMap } from './mapping.js'
import {
  TEMPLATE_HEADERS, buildTemplateRequests, buildOutreachFormula, clearConditionalFormatRequests,
} from './sheetTemplate.js'
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

/**
 * Fallback identity when no Google placeId exists (CSV imports, tabs without a
 * mapsUrl column). Normalised so systematic format differences between sources
 * still match: Google addresses end in ", United States", others often don't.
 */
export function fallbackIdentity(name: string, address: string): string {
  const addr = address.toLowerCase()
    .replace(/,\s*(united states|usa)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  return `${name.toLowerCase().replace(/\s+/g, ' ').trim()}|${addr}`
}

/** Identity for dedup: placeId, matching ResultsStore.insert. */
function identity(b: Business): string {
  return placeIdFromUrl(b.mapsUrl) || fallbackIdentity(b.name, b.address)
}

function existingIdentities(rows: string[][], map: HeaderMap): Set<string> {
  const seen = new Set<string>()
  for (const row of rows) {
    // Register BOTH identities per row: incoming businesses without a Google mapsUrl
    // (e.g. CSV imports) dedup by name|address, and must still match rows that were
    // written with a placeId.
    if (map.mapsUrlIndex >= 0) {
      const id = placeIdFromUrl(row[map.mapsUrlIndex] ?? '')
      if (id) seen.add(id)
    }
    const name = map.nameIndex >= 0 ? row[map.nameIndex] ?? '' : ''
    const address = map.addressIndex >= 0 ? row[map.addressIndex] ?? '' : ''
    if (name || address) seen.add(fallbackIdentity(name, address))
  }
  return seen
}

/** Turn a bare/empty tab into a fully styled Atlas lead tab (header + styling only). */
async function buildTab(
  client: SheetsClient, spreadsheetId: string, sheetTitle: string, sheetId: number,
): Promise<string[]> {
  await client.updateValues(spreadsheetId, `'${sheetTitle}'!A1`, [TEMPLATE_HEADERS])
  // Clear any pre-existing rules first — otherwise the template's rules are appended
  // to stale ones that may point at columns this layout repurposes.
  const existingRules = await client.conditionalFormatCount(spreadsheetId, sheetId)
  await client.batchUpdate(spreadsheetId, [
    ...clearConditionalFormatRequests(sheetId, existingRules),
    ...buildTemplateRequests(sheetId),
  ])
  return TEMPLATE_HEADERS
}

/**
 * (Re)install the whole-column Outreach ARRAYFORMULA.
 *
 * Must run AFTER appending: values:append writes the full row width including an empty
 * Outreach cell, which overwrites the formula at row 2 and blanks the column entirely.
 */
async function installOutreachFormula(
  client: SheetsClient, spreadsheetId: string, sheetTitle: string, map: HeaderMap,
): Promise<void> {
  if (map.outreachIndex < 0) return
  const letters = map.channelIndexes.map((i) => (i >= 0 ? columnLetter(i) : ''))
  if (!letters.some(Boolean)) return
  const col = columnLetter(map.outreachIndex)
  // Cells the append wrote as "" still count as occupied, which would make the
  // ARRAYFORMULA fail with #REF! rather than expanding. Clear the column first.
  await client.clearValues(spreadsheetId, `'${sheetTitle}'!${col}2:${col}`)
  // USER_ENTERED here on purpose: this one write IS a formula.
  await client.updateValues(
    spreadsheetId, `'${sheetTitle}'!${col}2`, [[buildOutreachFormula(letters)]], 'USER_ENTERED',
  )
}

export interface SplitOptions {
  spreadsheetId: string
  targets: ExportTarget[]
  /** When present, only rows whose placeId is in this list are exported. */
  placeIds?: string[]
}

/** Per-target write state: resolved tab, header map, dedup set, append buffer. */
class TabWriter {
  appended = 0
  skipped = 0
  private buffer: string[][] = []

  private constructor(
    private client: SheetsClient,
    private spreadsheetId: string,
    readonly sheetTitle: string,
    private map: HeaderMap,
    private seen: Set<string>,
  ) {}

  static async open(
    client: SheetsClient, spreadsheetId: string, target: ExportTarget,
    tabs: { sheetId: number; title: string }[],
  ): Promise<TabWriter> {
    let tab = tabs.find((t) => t.title === target.sheetTitle)
    if (!tab) {
      if (!target.createNew) {
        throw new ExportError(`Tab "${target.sheetTitle}" not found in the spreadsheet.`, 404)
      }
      const res = await client.batchUpdate(spreadsheetId, [{
        addSheet: {
          properties: {
            title: target.sheetTitle,
            gridProperties: { rowCount: 1000, columnCount: TEMPLATE_HEADERS.length },
          },
        },
      }])
      const created = res.replies[0] as { addSheet?: { properties?: { sheetId?: number } } }
      tab = { sheetId: created.addSheet?.properties?.sheetId ?? 0, title: target.sheetTitle }
    }

    const existing = await client.getValues(spreadsheetId, `'${target.sheetTitle}'!A1:BZ`)
    let headerRow = existing[0] ?? []
    // An empty tab (or one with no header) gets the full styled structure.
    if (headerRow.filter((h) => h.trim()).length === 0) {
      headerRow = await buildTab(client, spreadsheetId, target.sheetTitle, tab.sheetId)
    }
    const map = buildHeaderMap(headerRow)
    return new TabWriter(client, spreadsheetId, target.sheetTitle,
      map, existingIdentities(existing.slice(1), map))
  }

  /** Does this tab already contain the business? */
  has(b: Business): boolean {
    return this.seen.has(identity(b))
  }

  /** Count a business as skipped because this tab already holds it. */
  skip(): void {
    this.skipped++
  }

  /** Buffer a (pre-deduped) row, flushing at APPEND_BATCH. */
  async write(b: Business): Promise<void> {
    this.seen.add(identity(b))
    this.buffer.push(businessToRow(b, this.map))
    if (this.buffer.length >= APPEND_BATCH) await this.flush()
  }

  private async flush(): Promise<void> {
    if (!this.buffer.length) return
    await this.client.appendValues(this.spreadsheetId, `'${this.sheetTitle}'!A1`, this.buffer)
    this.appended += this.buffer.length
    this.buffer = []
  }

  /** Flush the tail, then reinstall the Outreach formula the appends blanked. */
  async close(): Promise<TabExportSummary> {
    await this.flush()
    await installOutreachFormula(this.client, this.spreadsheetId, this.sheetTitle, this.map)
    return { sheetTitle: this.sheetTitle, appended: this.appended, skipped: this.skipped }
  }
}

/** floor(total × pct/100) per target; remainder rows go to the first target. */
export function splitQuotas(total: number, percents: number[]): number[] {
  const quotas = percents.map((p) => Math.floor((total * p) / 100))
  const assigned = quotas.reduce((a, b) => a + b, 0)
  if (quotas.length) quotas[0] += total - assigned
  return quotas
}

/**
 * Export the scope (all rows, or the given placeIds) across one or more tabs.
 *
 * Dedup is checked across ALL target tabs, not just the one a row is assigned to.
 * Quota boundaries shift between runs as the store grows, so a row that landed in
 * tab A last export would otherwise fall in tab B's block this time and be appended
 * there a second time. Quotas are computed over only the genuinely-new rows, then
 * routed sequentially: the first quota-block to targets[0], the next to targets[1].
 */
export async function exportSplit(deps: ExporterDeps, opts: SplitOptions): Promise<SplitExportResult> {
  const { client, spreadsheetId } = { client: deps.client, spreadsheetId: opts.spreadsheetId }
  if (!opts.targets.length) throw new ExportError('At least one target tab is required.', 400)
  const pctTotal = opts.targets.reduce((a, t) => a + t.percent, 0)
  if (pctTotal !== 100) throw new ExportError(`Target percentages sum to ${pctTotal}, not 100.`, 400)

  const wanted = opts.placeIds ? new Set(opts.placeIds) : null
  const total = wanted ? wanted.size : deps.count()
  const cap = deps.maxRows ?? MAX_EXPORT_ROWS

  // Check the cap before any write, so we never leave a half-populated sheet.
  if (total > cap) {
    throw new ExportError(
      `${total.toLocaleString()} rows exceeds the Google Sheets export limit of ` +
      `${cap.toLocaleString()}. Use Export CSV instead.`,
      413,
    )
  }

  const tabs = await client.getTabs(spreadsheetId)

  // Open every target up front so all existing rows are known before routing —
  // and so createNew still builds a styled tab even at a 0-row quota.
  const writers: TabWriter[] = []
  for (const target of opts.targets) {
    writers.push(await TabWriter.open(client, spreadsheetId, target, tabs))
  }

  // Pull-based stream of genuinely-new rows. A row present in ANY target tab is
  // skipped (attributed to the tab that holds it) rather than re-appended elsewhere.
  // Streams from SQLite in batches — the full result set is never held in memory.
  function* newRows(): Generator<Business> {
    for (const batch of deps.iterate(1000)) {
      for (const b of batch) {
        if (wanted && !wanted.has(b.placeId)) continue
        const holder = writers.find((w) => w.has(b))
        if (holder) { holder.skip(); continue }
        yield b
      }
    }
  }

  // First pass: count new rows so the percentages divide what will actually be
  // written. (Skip counts from this pass are discarded to avoid double-counting.)
  let newTotal = 0
  for (const batch of deps.iterate(1000)) {
    for (const b of batch) {
      if (wanted && !wanted.has(b.placeId)) continue
      if (!writers.some((w) => w.has(b))) newTotal++
    }
  }

  const quotas = splitQuotas(newTotal, opts.targets.map((t) => t.percent))
  const stream = newRows()

  const summaries: TabExportSummary[] = []
  for (let ti = 0; ti < writers.length; ti++) {
    for (let assigned = 0; assigned < quotas[ti]; assigned++) {
      const next = stream.next()
      if (next.done) break
      await writers[ti].write(next.value)
    }
  }
  // Drain the tail so duplicates after the last new row still get their skip counted.
  while (!stream.next().done) { /* skip attribution happens inside newRows() */ }
  for (const w of writers) summaries.push(await w.close())

  return { perTab: summaries, total }
}

/** Single-tab export: one target taking 100% of the scope. */
export async function exportToSheet(deps: ExporterDeps, opts: ExportOptions): Promise<ExportResult> {
  const res = await exportSplit(deps, {
    spreadsheetId: opts.spreadsheetId,
    targets: [{ sheetTitle: opts.sheetTitle, createNew: opts.createNew, percent: 100 }],
  })
  const t = res.perTab[0]
  return { appended: t.appended, skipped: t.skipped, total: res.total }
}
