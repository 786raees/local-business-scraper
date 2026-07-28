import { SpreadsheetRef, TabRef } from '../types.js'

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

export class SheetsClient {
  constructor(
    private auth: TokenSource,
    private fetchImpl: typeof fetch = fetch,
    private baseDelayMs = 500,
  ) {}

  private async request<T>(url: string, init: RequestInit = {}): Promise<T> {
    let lastError: SheetsApiError | null = null
    for (let attempt = 0; attempt < 3; attempt++) {
      const token = await this.auth.getToken()
      const res = await this.fetchImpl(url, {
        ...init,
        headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` },
      })
      const body = await res.json().catch(() => ({})) as { error?: { message?: string } }
      if (res.ok) return body as T
      lastError = new SheetsApiError(body.error?.message ?? `HTTP ${res.status}`, res.status)
      if (!RETRYABLE.has(res.status)) throw lastError
      if (attempt < 2) await sleep(this.baseDelayMs * 2 ** attempt)
    }
    throw lastError
  }

  /** Only spreadsheets shared with the service account are visible. */
  async listSpreadsheets(): Promise<SpreadsheetRef[]> {
    const q = encodeURIComponent("mimeType='application/vnd.google-apps.spreadsheet' and trashed=false")
    const body = await this.request<{ files?: { id: string; name: string }[] }>(
      `${DRIVE}?q=${q}&fields=files(id,name)&orderBy=modifiedTime desc&pageSize=100`)
    return (body.files ?? []).map((f) => ({ id: f.id, name: f.name }))
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
      `${SHEETS}/${spreadsheetId}/values/${encodeURIComponent(range)}`)
    return body.values ?? []
  }

  async appendValues(spreadsheetId: string, range: string, values: string[][]): Promise<void> {
    // RAW is mandatory: USER_ENTERED makes Sheets parse "+1 305-..." as a formula.
    await this.request(
      `${SHEETS}/${spreadsheetId}/values/${encodeURIComponent(range)}:append` +
      `?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ values }) },
    )
  }

  /**
   * USER_ENTERED on purpose — this is only used to install the Outreach ARRAYFORMULA,
   * which must be interpreted as a formula rather than stored as literal text.
   */
  async updateValues(spreadsheetId: string, range: string, values: string[][]): Promise<void> {
    await this.request(
      `${SHEETS}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
      { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ values }) },
    )
  }

  /**
   * Empty a range completely. Needed before writing an ARRAYFORMULA: cells written
   * as "" by values:append still count as occupied, so the array cannot expand into
   * them and the formula yields #REF!.
   */
  async clearValues(spreadsheetId: string, range: string): Promise<void> {
    await this.request(
      `${SHEETS}/${spreadsheetId}/values/${encodeURIComponent(range)}:clear`,
      { method: 'POST' },
    )
  }

  async batchUpdate(spreadsheetId: string, requests: unknown[]): Promise<{ replies: unknown[] }> {
    return this.request(`${SHEETS}/${spreadsheetId}:batchUpdate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requests }),
    })
  }
}
