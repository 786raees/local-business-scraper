import { describe, expect, it, vi } from 'vitest'
import { SheetsApiError, SheetsClient, cellRange } from '../src/sheets/client'

const auth = { getToken: async () => 'tok' }

interface Call { url: string; init?: RequestInit }

function fetchStub(responses: { status: number; body?: unknown }[], calls: Call[]): typeof fetch {
  let i = 0
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    const r = responses[Math.min(i++, responses.length - 1)]
    return {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => r.body ?? {},
    }
  }) as typeof fetch
}

describe('SheetsClient retry matrix', () => {
  it.each([429, 500, 502, 503, 504])('retries %i and succeeds', async (status) => {
    const calls: Call[] = []
    const client = new SheetsClient(
      auth,
      fetchStub([{ status }, { status: 200, body: { files: [] } }], calls),
      0, // no real backoff delay in tests
    )
    expect(await client.listSpreadsheets()).toEqual([])
    expect(calls).toHaveLength(2)
  })

  it('gives up after 3 attempts on persistent 503', async () => {
    const calls: Call[] = []
    const client = new SheetsClient(auth, fetchStub([{ status: 503 }], calls), 0)
    await expect(client.listSpreadsheets()).rejects.toThrow(SheetsApiError)
    expect(calls).toHaveLength(3)
  })

  it.each([401, 403, 404])('fails fast on %i — a retry never fixes it', async (status) => {
    const calls: Call[] = []
    const client = new SheetsClient(
      auth,
      fetchStub([{ status, body: { error: { message: 'The caller does not have permission' } } }], calls),
      0,
    )
    const err = await client.listSpreadsheets().catch((e: SheetsApiError) => e)
    expect(err).toBeInstanceOf(SheetsApiError)
    expect((err as SheetsApiError).status).toBe(status)
    expect(calls).toHaveLength(1)
  })

  it('backs off exponentially between retries', async () => {
    vi.useFakeTimers()
    const calls: Call[] = []
    const client = new SheetsClient(auth, fetchStub([{ status: 503 }], calls), 500)
    const pending = client.listSpreadsheets().catch((e: SheetsApiError) => e)
    await vi.advanceTimersByTimeAsync(500) // attempt 1 → 2
    await vi.advanceTimersByTimeAsync(1000) // attempt 2 → 3
    expect(await pending).toBeInstanceOf(SheetsApiError)
    expect(calls).toHaveLength(3)
    vi.useRealTimers()
  })
})

describe('reads', () => {
  it('lists spreadsheets newest-modified first with the Drive query', async () => {
    const calls: Call[] = []
    const client = new SheetsClient(
      auth,
      fetchStub([{ status: 200, body: { files: [{ id: 'a', name: 'Leads' }] } }], calls),
    )
    expect(await client.listSpreadsheets()).toEqual([{ id: 'a', name: 'Leads' }])
    expect(calls[0].url).toContain('orderBy=modifiedTime desc')
    expect(calls[0].url).toContain('spreadsheet')
    expect(calls[0].url).toContain('trashed%3Dfalse')
  })

  it('maps tabs with row counts', async () => {
    const client = new SheetsClient(auth, fetchStub([{
      status: 200,
      body: { sheets: [{ properties: { sheetId: 7, title: 'Leads', gridProperties: { rowCount: 312 } } }] },
    }], []))
    expect(await client.getTabs('sid')).toEqual([{ sheetId: 7, title: 'Leads', rowCount: 312 }])
  })

  it('returns [] for an empty range', async () => {
    const client = new SheetsClient(auth, fetchStub([{ status: 200, body: {} }], []))
    expect(await client.getValues('sid', 'Leads!A1:Z1')).toEqual([])
  })
})

describe('updateCell — the only write', () => {
  it('PUTs a single cell with valueInputOption=RAW', async () => {
    const calls: Call[] = []
    const client = new SheetsClient(auth, fetchStub([{ status: 200 }], calls))
    await client.updateCell('sid', 'My Leads', 'C42', 'Answered')

    const { url, init } = calls[0]
    expect(init?.method).toBe('PUT')
    expect(url).toContain('valueInputOption=RAW')
    expect(url).not.toContain('USER_ENTERED')
    expect(url).toContain(encodeURIComponent("'My Leads'!C42"))
    expect(JSON.parse(String(init?.body))).toEqual({ values: [['Answered']] })
  })

  it('escapes single quotes in tab titles', () => {
    expect(cellRange("Bob's Leads", 'B2')).toBe("'Bob''s Leads'!B2")
  })
})
