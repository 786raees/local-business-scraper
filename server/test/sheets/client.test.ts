import { describe, it, expect, vi } from 'vitest'
import { SheetsClient } from '../../src/sheets/client.js'

const auth = { getToken: async () => 'test-token' }

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

describe('SheetsClient.listSpreadsheets', () => {
  it('queries Drive for spreadsheets and maps the result', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      files: [{ id: 'a', name: 'Plumber leads' }, { id: 'b', name: 'Other' }],
    }))
    const client = new SheetsClient(auth, fetchImpl as unknown as typeof fetch)
    expect(await client.listSpreadsheets()).toEqual([
      { id: 'a', name: 'Plumber leads' },
      { id: 'b', name: 'Other' },
    ])
    const url = String(fetchImpl.mock.calls[0][0])
    expect(url).toContain('mimeType')
    expect(url).toContain('spreadsheet')
  })

  it('sends the bearer token', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ files: [] }))
    await new SheetsClient(auth, fetchImpl as unknown as typeof fetch).listSpreadsheets()
    const init = fetchImpl.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer test-token')
  })
})

describe('SheetsClient.getTabs', () => {
  it('maps sheet properties to TabRef', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({
      sheets: [
        { properties: { sheetId: 0, title: 'Faizan', gridProperties: { rowCount: 1000 } } },
        { properties: { sheetId: 7, title: 'Amna', gridProperties: { rowCount: 500 } } },
      ],
    }))
    const client = new SheetsClient(auth, fetchImpl as unknown as typeof fetch)
    expect(await client.getTabs('sid')).toEqual([
      { sheetId: 0, title: 'Faizan', rowCount: 1000 },
      { sheetId: 7, title: 'Amna', rowCount: 500 },
    ])
  })
})

describe('SheetsClient.appendValues', () => {
  it('uses RAW input so phone numbers are not parsed as formulas', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}))
    const client = new SheetsClient(auth, fetchImpl as unknown as typeof fetch)
    await client.appendValues('sid', 'Faizan!A1', [['+1 305-697-3490']])
    expect(String(fetchImpl.mock.calls[0][0])).toContain('valueInputOption=RAW')
  })
})

describe('SheetsClient.updateValues', () => {
  it('defaults to RAW so a leading-+ phone number is not parsed as a formula', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}))
    const client = new SheetsClient(auth, fetchImpl as unknown as typeof fetch)
    await client.updateValues('sid', 'Faizan!A2', [['+1 786-474-6894']])
    expect(String(fetchImpl.mock.calls[0][0])).toContain('valueInputOption=RAW')
  })

  it('uses USER_ENTERED only when explicitly asked', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}))
    const client = new SheetsClient(auth, fetchImpl as unknown as typeof fetch)
    await client.updateValues('sid', 'Faizan!H2', [['=ARRAYFORMULA(1)']], 'USER_ENTERED')
    expect(String(fetchImpl.mock.calls[0][0])).toContain('valueInputOption=USER_ENTERED')
  })
})

describe('SheetsClient error handling', () => {
  it('throws SheetsApiError carrying the HTTP status', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { message: 'denied' } }, 403))
    const client = new SheetsClient(auth, fetchImpl as unknown as typeof fetch)
    await expect(client.getTabs('sid')).rejects.toMatchObject({ status: 403 })
  })

  it('retries on 429 and succeeds', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ error: { message: 'rate' } }, 429))
      .mockResolvedValueOnce(jsonResponse({ sheets: [] }))
    const client = new SheetsClient(auth, fetchImpl as unknown as typeof fetch, 0)
    expect(await client.getTabs('sid')).toEqual([])
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('gives up after 3 attempts on repeated 500s', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { message: 'boom' } }, 500))
    const client = new SheetsClient(auth, fetchImpl as unknown as typeof fetch, 0)
    await expect(client.getTabs('sid')).rejects.toThrow()
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('does not retry a 403', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { message: 'denied' } }, 403))
    const client = new SheetsClient(auth, fetchImpl as unknown as typeof fetch, 0)
    await expect(client.getTabs('sid')).rejects.toThrow()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})
