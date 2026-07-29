import type { SpreadsheetRef, TabRef } from '../shared/types'

/**
 * Sheets/Drive REST client — browser port of Atlas server/src/sheets/client.ts
 * (ARCHITECTURE §5.2). Plain fetch, no SDK.
 *
 * Write policy, inherited from Atlas and made structural here:
 * - The ONLY write method is updateCell — a single-cell values.update with
 *   valueInputOption=RAW. There is deliberately no append and no multi-cell
 *   write: a row-width write would clobber the Outreach ARRAYFORMULA column,
 *   and USER_ENTERED turns phone-like strings into #ERROR! formulas.
 */

export class SheetsApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
    this.name = 'SheetsApiError'
  }
}

interface TokenSource { getToken(): Promise<string> }

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets'
const DRIVE = 'https://www.googleapis.com/drive/v3/files'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Transient failures worth retrying. A 403 (not shared) never becomes a 200. */
const RETRYABLE = new Set([429, 500, 502, 503, 504])

/** A1 range for one cell of a titled tab: `'My Leads'!C42` (inner quotes doubled). */
export function cellRange(tabTitle: string, a1Cell: string): string {
  return `'${tabTitle.replace(/'/g, "''")}'!${a1Cell}`
}

export class SheetsClient {
  constructor(
    private auth: TokenSource,
    // Bound, or calling it as this.fetchImpl() throws "Illegal invocation":
    // fetch requires its `this` to be the global scope.
    private fetchImpl: typeof fetch = fetch.bind(globalThis),
    private baseDelayMs = 500,
  ) {}

  private async request<T>(url: string, init: RequestInit = {}): Promise<T> {
    let lastError: SheetsApiError | null = null
    for (let attempt = 0; attempt < 3; attempt++) {
      const token = await this.auth.getToken()
      const res = await this.fetchImpl(url, {
        ...init,
        headers: { ...init.headers, authorization: `Bearer ${token}` },
      })
      const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
      if (res.ok) return body as T
      lastError = new SheetsApiError(body.error?.message ?? `HTTP ${res.status}`, res.status)
      if (!RETRYABLE.has(res.status)) throw lastError
      if (attempt < 2) await sleep(this.baseDelayMs * 2 ** attempt)
    }
    throw lastError
  }

  /** Only spreadsheets shared with the service account are visible. */
  async listSpreadsheets(): Promise<SpreadsheetRef[]> {
    const q = encodeURIComponent(
      "mimeType='application/vnd.google-apps.spreadsheet' and trashed=false",
    )
    const body = await this.request<{
      files?: { id: string; name: string; modifiedTime?: string }[]
    }>(
      `${DRIVE}?q=${q}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&pageSize=100`,
    )
    return (body.files ?? []).map((f) => ({
      id: f.id,
      name: f.name,
      modifiedTime: f.modifiedTime,
    }))
  }

  async getTabs(spreadsheetId: string): Promise<TabRef[]> {
    const fields = encodeURIComponent('sheets.properties(sheetId,title,gridProperties.rowCount)')
    const body = await this.request<{
      sheets?: { properties: { sheetId: number; title: string; gridProperties?: { rowCount?: number } } }[]
    }>(`${SHEETS}/${spreadsheetId}?fields=${fields}`)
    return (body.sheets ?? []).map((s) => ({
      sheetId: s.properties.sheetId,
      title: s.properties.title,
      rowCount: s.properties.gridProperties?.rowCount ?? 0,
    }))
  }

  async getValues(spreadsheetId: string, range: string): Promise<string[][]> {
    const body = await this.request<{ values?: string[][] }>(
      `${SHEETS}/${spreadsheetId}/values/${encodeURIComponent(range)}`,
    )
    return body.values ?? []
  }

  /**
   * The extension's only write: one cell, RAW. Callers pass the tab title and a
   * bare A1 cell (e.g. "C42"); quoting/escaping happens here.
   */
  async updateCell(
    spreadsheetId: string,
    tabTitle: string,
    a1Cell: string,
    value: string,
  ): Promise<void> {
    const range = cellRange(tabTitle, a1Cell)
    await this.request(
      `${SHEETS}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
      {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ values: [[value]] }),
      },
    )
  }
}
