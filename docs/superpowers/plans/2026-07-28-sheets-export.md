# Google Sheets Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user export scraped results straight into a chosen tab of a chosen Google Spreadsheet, as an alternative to CSV download, without disturbing that tab's formatting or its CRM columns.

**Architecture:** A new `server/src/sheets/` module authenticates with a Google service account (self-signed JWT, no SDK), reads the target tab's header row to map Atlas fields onto existing columns by name, dedups against rows already present using `placeId`, then appends in batches streamed from SQLite. A new React dialog drives destination → spreadsheet → tab selection.

**Tech Stack:** Node 22+ (`node:crypto`, global `fetch`), Express 4, TypeScript (strict, ESM, `.js` import specifiers), Vitest, React 19, Zustand, Tailwind.

## Global Constraints

- **No new runtime dependencies.** Use `node:crypto` + global `fetch`. Do not add `googleapis`.
- **ESM import specifiers must end in `.js`** even for `.ts` files (e.g. `from './auth.js'`). Existing code does this; `moduleResolution` is `Bundler` but the runtime is ESM.
- **`server/src/types.ts` and `web/src/lib/types.ts` are hand-kept in sync.** Any shared shape must be added to both, identically.
- **Rows are never all held in memory.** Stream via `iterate(batch)`; the CSV route is the reference pattern.
- **All Google Sheets styling lives in `sheetTemplate.ts`** — the single source of truth, mirroring `selectors.ts` for the Maps DOM.
- **`valueInputOption` must be `RAW` on every write.** `USER_ENTERED` makes Sheets parse `+1 305-697-3490` as a formula and error.
- **Never write into the `Outreach` column.** It holds a whole-column `ARRAYFORMULA`; writing a value into any row of it breaks the formula for the entire column.
- **Channel columns use reserved names** `Call Status`, `SMS Status`, `FB Status`, `IG Status`, `LI Status` — never `Facebook`/`Instagram`/`LinkedIn`, which collide with the existing `Business` URL fields under case-insensitive matching.
- **Run tests from `server/`** with `npx vitest run <path>`. Web tests run from `web/`.
- **End every git commit message with:** `Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>`

## File Structure

**Create**
| File | Responsibility |
|---|---|
| `server/src/sheets/auth.ts` | Service-account key loading, JWT assertion building, token exchange + cache. |
| `server/src/sheets/client.ts` | REST wrapper over Sheets + Drive APIs. Retry/backoff. Injectable `fetch`. |
| `server/src/sheets/sheetTemplate.ts` | Headers, channel vocabularies, colours, dropdowns, conditional formats, summary formula. |
| `server/src/sheets/mapping.ts` | Header-row → column mapping; `Business` → row array. Pure functions. |
| `server/src/sheets/exporter.ts` | Orchestration: cap check → dedup → batched append. |
| `server/scripts/migrate-sheet.ts` | One-off migration of existing rep tabs to the new column model. |
| `web/src/components/ExportDialog.tsx` | Destination → spreadsheet → tab → summary flow. |

**Modify**
| File | Change |
|---|---|
| `server/src/scraper/listingParser.ts` | Add `cleanText()`. |
| `server/src/scraper/mapsScraper.ts:42-48` | `textOrEmpty` uses `cleanText` instead of `.trim()`. |
| `server/src/types.ts` | Add `SpreadsheetRef`, `TabRef`, `ExportResult`. |
| `server/src/api/routes.ts` | Add `sheets` to `RouteDeps`; add 3 routes. |
| `server/src/index.ts` | Construct auth/client/exporter, inject. |
| `web/src/lib/types.ts` | Mirror the three shared types. |
| `web/src/lib/api.ts` | Add 3 client methods. |
| `web/src/components/TopBar.tsx` | Export button opens the dialog. |
| `.gitignore` | Ignore credential files. |
| `CLAUDE.md` | Document the sheets module. |

> **Deviation from the spec:** the spec listed four files with mapping inside `exporter.ts`. This plan splits mapping into its own `mapping.ts` because it is pure, heavily tested, and keeps `exporter.ts` focused on orchestration.

---

### Task 1: Strip Material icon glyphs at source

Scraped `address`/`phone`/`hours` begin with a Unicode Private Use Area codepoint (`U+E0C8`, `U+E0B0`) — Google's Material icon ligatures captured as text. `trim()` cannot remove them because they are not whitespace. `textOrEmpty` is the single choke point every text field flows through.

**Files:**
- Modify: `server/src/scraper/listingParser.ts`
- Modify: `server/src/scraper/mapsScraper.ts:42-48`
- Test: `server/test/listingParser.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `cleanText(s: string): string` exported from `listingParser.ts`.

- [ ] **Step 1: Write the failing test**

Append to `server/test/listingParser.test.ts`:

```ts
import { cleanText } from '../src/scraper/listingParser.js'

describe('cleanText', () => {
  it('strips leading Material icon glyphs from addresses', () => {
    expect(cleanText('\ue0c8 4637 SW 75th Ave, Miami, FL 33155'))
      .toBe('4637 SW 75th Ave, Miami, FL 33155')
  })
  it('strips the phone glyph', () => {
    expect(cleanText('\ue0b0 +1 305-697-3490')).toBe('+1 305-697-3490')
  })
  it('collapses newline runs from multi-line hours', () => {
    expect(cleanText('\nOpen 24 hours\n\nUpdated 5 days ago'))
      .toBe('Open 24 hours Updated 5 days ago')
  })
  it('removes PUA glyphs anywhere in the string', () => {
    expect(cleanText('a\ue000b\uf8ffc')).toBe('abc')
  })
  it('passes clean text through unchanged', () => {
    expect(cleanText('Plumber')).toBe('Plumber')
  })
  it('handles empty input', () => {
    expect(cleanText('')).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run test/listingParser.test.ts`
Expected: FAIL — `cleanText` is not exported.

- [ ] **Step 3: Write minimal implementation**

Add to the top of `server/src/scraper/listingParser.ts`, after the file's existing imports (there are none — put it above `placeIdFromUrl`):

```ts
/**
 * Google renders a Material icon before the address/phone/hours text, and its ligature
 * codepoint lands in innerText as a Private Use Area character (U+E0C8 address,
 * U+E0B0 phone). These are not whitespace, so trim() cannot remove them — they must be
 * stripped explicitly or they end up in the DB, the CSV, and every Sheets export.
 */
export function cleanText(s: string): string {
  return s
    .replace(/[\ue000-\uf8ff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run test/listingParser.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire it into the scraper**

In `server/src/scraper/mapsScraper.ts`, change `textOrEmpty` (currently lines 42-48):

```ts
async function textOrEmpty(page: Page, selector: string): Promise<string> {
  try {
    const el = page.locator(selector).first()
    if (await el.count()) return cleanText(await el.innerText())
  } catch { /* ignore */ }
  return ''
}
```

Add `cleanText` to the existing import from `./listingParser.js` in that file.

- [ ] **Step 6: Run the full server suite**

Run: `cd server && npx vitest run`
Expected: PASS (the live scrape smoke test stays skipped without `RUN_SMOKE=1`).

- [ ] **Step 7: Commit**

```bash
git add server/src/scraper/listingParser.ts server/src/scraper/mapsScraper.ts server/test/listingParser.test.ts
git commit -m "fix: strip Material icon glyphs from scraped text

Google's address/phone/hours icons land in innerText as Private Use Area
codepoints (U+E0C8, U+E0B0). They are not whitespace so trim() left them
in place, contaminating the DB, CSV export and Sheets export.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Credential hygiene and service-account auth

**Files:**
- Create: `server/src/sheets/auth.ts`
- Create: `server/test/sheets/auth.test.ts`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `interface ServiceAccountKey { client_email: string; private_key: string; token_uri: string }`
  - `buildAssertion(key: ServiceAccountKey, scopes: string[], nowSec: number): string`
  - `class SheetsAuth { constructor(keyPath?: string); isConfigured(): boolean; getToken(): Promise<string> }`

- [ ] **Step 1: Protect the private key first**

Append to `.gitignore`:

```
# Google service-account credentials — never commit
n8n-chatbot.json
.google-service-account.json
server/.google-service-account.json
```

Verify nothing is already tracked:

```bash
git check-ignore -v n8n-chatbot.json
git ls-files | grep -i -E 'service-account|n8n-chatbot' || echo "not tracked - good"
```

Expected: `check-ignore` prints a matching rule; the second command prints `not tracked - good`.

- [ ] **Step 2: Write the failing test**

Create `server/test/sheets/auth.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { createSign, generateKeyPairSync, createVerify } from 'node:crypto'
import { buildAssertion, SheetsAuth } from '../../src/sheets/auth.js'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const KEY = {
  client_email: 'svc@example.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  token_uri: 'https://oauth2.googleapis.com/token',
}

function decode(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
}

describe('buildAssertion', () => {
  it('produces a three-part JWT', () => {
    expect(buildAssertion(KEY, ['scope-a'], 1000).split('.')).toHaveLength(3)
  })

  it('sets RS256 in the header', () => {
    const [h] = buildAssertion(KEY, ['scope-a'], 1000).split('.')
    expect(decode(h)).toEqual({ alg: 'RS256', typ: 'JWT' })
  })

  it('sets issuer, audience, space-joined scopes and a one-hour expiry', () => {
    const [, c] = buildAssertion(KEY, ['scope-a', 'scope-b'], 1000).split('.')
    expect(decode(c)).toEqual({
      iss: 'svc@example.iam.gserviceaccount.com',
      scope: 'scope-a scope-b',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1000,
      exp: 4600,
    })
  })

  it('signs with the private key so the public key verifies it', () => {
    const jwt = buildAssertion(KEY, ['scope-a'], 1000)
    const [h, c, sig] = jwt.split('.')
    const ok = createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(sig, 'base64url'))
    expect(ok).toBe(true)
  })
})

describe('SheetsAuth.isConfigured', () => {
  it('is false when the key file is missing', () => {
    expect(new SheetsAuth('/nonexistent/key.json').isConfigured()).toBe(false)
  })
})
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd server && npx vitest run test/sheets/auth.test.ts`
Expected: FAIL — cannot resolve `../../src/sheets/auth.js`.

- [ ] **Step 4: Write the implementation**

Create `server/src/sheets/auth.ts`:

```ts
import { createSign } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'

export interface ServiceAccountKey {
  client_email: string
  private_key: string
  token_uri: string
}

export const SHEETS_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
]

const DEFAULT_KEY_PATH = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  ?? '.google-service-account.json'

const b64 = (o: unknown): string =>
  Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url')

/**
 * Build the signed JWT Google exchanges for an access token. Split out from the
 * network call so it can be verified in tests without hitting Google.
 */
export function buildAssertion(key: ServiceAccountKey, scopes: string[], nowSec: number): string {
  const header = b64({ alg: 'RS256', typ: 'JWT' })
  const claim = b64({
    iss: key.client_email,
    scope: scopes.join(' '),
    aud: key.token_uri,
    iat: nowSec,
    exp: nowSec + 3600,
  })
  const unsigned = `${header}.${claim}`
  const sig = createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url')
  return `${unsigned}.${sig}`
}

/** Loads the key lazily and caches the access token until shortly before expiry. */
export class SheetsAuth {
  private key: ServiceAccountKey | null = null
  private token = ''
  private expiresAt = 0

  constructor(private keyPath: string = DEFAULT_KEY_PATH) {}

  isConfigured(): boolean {
    return existsSync(this.keyPath)
  }

  /** The address a spreadsheet must be shared with. Empty when unconfigured. */
  clientEmail(): string {
    try { return this.load().client_email } catch { return '' }
  }

  private load(): ServiceAccountKey {
    if (this.key) return this.key
    if (!existsSync(this.keyPath)) {
      throw new Error(`Google service-account key not found at ${this.keyPath}`)
    }
    const parsed = JSON.parse(readFileSync(this.keyPath, 'utf8')) as ServiceAccountKey
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error(`Malformed service-account key at ${this.keyPath}`)
    }
    parsed.token_uri ||= 'https://oauth2.googleapis.com/token'
    this.key = parsed
    return parsed
  }

  async getToken(): Promise<string> {
    const nowSec = Math.floor(Date.now() / 1000)
    // Refresh 60s early so a token never expires mid-request.
    if (this.token && nowSec < this.expiresAt - 60) return this.token
    const key = this.load()
    const res = await fetch(key.token_uri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: buildAssertion(key, SHEETS_SCOPES, nowSec),
      }),
    })
    const body = await res.json() as { access_token?: string; error_description?: string }
    if (!body.access_token) {
      throw new Error(`Google token exchange failed: ${body.error_description ?? res.status}`)
    }
    this.token = body.access_token
    this.expiresAt = nowSec + 3600
    return this.token
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && npx vitest run test/sheets/auth.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 6: Move the key into place**

```bash
mv "n8n-chatbot.json" server/.google-service-account.json
git status --short
```

Expected: `.gitignore` modified; the key file does **not** appear as untracked.

- [ ] **Step 7: Commit**

```bash
git add .gitignore server/src/sheets/auth.ts server/test/sheets/auth.test.ts
git commit -m "feat: service-account auth for Google Sheets

Self-signed JWT exchanged for an access token, cached until 60s before
expiry. No SDK dependency. Also gitignores credential files, which were
previously one 'git add .' from being committed.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Sheets/Drive REST client

**Files:**
- Create: `server/src/sheets/client.ts`
- Create: `server/test/sheets/client.test.ts`
- Modify: `server/src/types.ts`

**Interfaces:**
- Consumes: `SheetsAuth` from Task 2 (only its `getToken()` method, via a structural type).
- Produces:
  - In `server/src/types.ts`: `SpreadsheetRef { id: string; name: string }`, `TabRef { sheetId: number; title: string; rowCount: number }`, `ExportResult { appended: number; skipped: number; total: number }`
  - `class SheetsClient` with `listSpreadsheets()`, `getTabs(id)`, `getValues(id, range)`, `appendValues(id, range, values)`, `batchUpdate(id, requests)`
  - `class SheetsApiError extends Error { status: number }`

- [ ] **Step 1: Add the shared types**

Append to `server/src/types.ts`:

```ts
/** A spreadsheet the service account can see (i.e. one shared with it). */
export interface SpreadsheetRef {
  id: string
  name: string
}

/** A tab within a spreadsheet. */
export interface TabRef {
  sheetId: number
  title: string
  rowCount: number
}

/** Outcome of a Sheets export. `total` is rows considered, not rows written. */
export interface ExportResult {
  appended: number
  skipped: number
  total: number
}
```

- [ ] **Step 2: Write the failing test**

Create `server/test/sheets/client.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { SheetsClient, SheetsApiError } from '../../src/sheets/client.js'

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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd server && npx vitest run test/sheets/client.test.ts`
Expected: FAIL — cannot resolve `client.js`.

- [ ] **Step 4: Write the implementation**

Create `server/src/sheets/client.ts`:

```ts
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

  async updateValues(spreadsheetId: string, range: string, values: string[][]): Promise<void> {
    await this.request(
      `${SHEETS}/${spreadsheetId}/values/${encodeURIComponent(range)}?valueInputOption=USER_ENTERED`,
      { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ values }) },
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
```

> Note: `updateValues` deliberately uses `USER_ENTERED` — it is used only to write the `ARRAYFORMULA` in Task 4, which must be interpreted as a formula, never as text.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && npx vitest run test/sheets/client.test.ts`
Expected: PASS, 8 tests.

- [ ] **Step 6: Commit**

```bash
git add server/src/sheets/client.ts server/test/sheets/client.test.ts server/src/types.ts
git commit -m "feat: Sheets and Drive REST client with retry

Injectable fetch for testing. Retries 429/5xx with exponential backoff,
fails fast on 403 since a permissions error never becomes success.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Sheet template — the styling single source of truth

**Files:**
- Create: `server/src/sheets/sheetTemplate.ts`
- Create: `server/test/sheets/template.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `RESERVED_HEADERS: string[]`, `STAGE_VALUES: string[]`, `PRIORITY_VALUES: string[]`
  - `CHANNELS: { header: string; prefix: string; values: string[] }[]`
  - `CRM_HEADERS: string[]` (the 9 CRM columns in order)
  - `TEMPLATE_HEADERS: string[]` (CRM + Atlas = 33 headers, `name` first)
  - `OUTREACH_FORMULA: string`
  - `buildTemplateRequests(sheetId: number): unknown[]`

- [ ] **Step 1: Write the failing test**

Create `server/test/sheets/template.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import {
  RESERVED_HEADERS, CHANNELS, STAGE_VALUES, TEMPLATE_HEADERS,
  CRM_HEADERS, OUTREACH_FORMULA, buildTemplateRequests,
} from '../../src/sheets/sheetTemplate.js'
import { ALL_COLUMNS } from '../../src/export/csv.js'

describe('template headers', () => {
  it('starts with name then the nine CRM columns', () => {
    expect(TEMPLATE_HEADERS.slice(0, 10)).toEqual([
      'name', 'Stage', 'Call Status', 'SMS Status', 'FB Status', 'IG Status', 'LI Status',
      'Outreach', 'Priority', 'Notes',
    ])
  })

  it('contains every Atlas column exactly once', () => {
    for (const col of ALL_COLUMNS) {
      expect(TEMPLATE_HEADERS.filter((h) => h === col)).toHaveLength(1)
    }
  })

  it('is 33 columns wide', () => {
    expect(TEMPLATE_HEADERS).toHaveLength(ALL_COLUMNS.length + CRM_HEADERS.length)
    expect(TEMPLATE_HEADERS).toHaveLength(34)
  })

  it('never uses a channel name that collides with an Atlas URL field', () => {
    const lower = ALL_COLUMNS.map((c) => String(c).toLowerCase())
    for (const ch of CHANNELS) {
      expect(lower).not.toContain(ch.header.toLowerCase())
    }
  })
})

describe('reserved headers', () => {
  it('covers all nine CRM columns', () => {
    expect(RESERVED_HEADERS).toHaveLength(9)
    expect(RESERVED_HEADERS).toContain('Outreach')
    expect(RESERVED_HEADERS).toContain('Stage')
  })
})

describe('channels', () => {
  it('defines five channels', () => {
    expect(CHANNELS.map((c) => c.header)).toEqual([
      'Call Status', 'SMS Status', 'FB Status', 'IG Status', 'LI Status',
    ])
  })
  it('gives every channel a non-empty vocabulary', () => {
    for (const c of CHANNELS) expect(c.values.length).toBeGreaterThan(0)
  })
})

describe('stage vocabulary', () => {
  it('starts at New and includes both closed states', () => {
    expect(STAGE_VALUES[0]).toBe('New')
    expect(STAGE_VALUES).toContain('Closed-Won')
    expect(STAGE_VALUES).toContain('Closed-Lost')
  })
})

describe('OUTREACH_FORMULA', () => {
  it('is an ARRAYFORMULA covering the whole column', () => {
    expect(OUTREACH_FORMULA.startsWith('=ARRAYFORMULA(')).toBe(true)
  })
  it('references all five channel columns C through G', () => {
    for (const col of ['C2:C', 'D2:D', 'E2:E', 'F2:F', 'G2:G']) {
      expect(OUTREACH_FORMULA).toContain(col)
    }
  })
})

describe('buildTemplateRequests', () => {
  const reqs = buildTemplateRequests(42) as Record<string, any>[]

  it('freezes the header row and the name column', () => {
    const frozen = reqs.find((r) => r.updateSheetProperties)
    expect(frozen.updateSheetProperties.properties.gridProperties).toMatchObject({
      frozenRowCount: 1, frozenColumnCount: 1,
    })
  })

  it('creates one dropdown per channel plus Stage and Priority', () => {
    const dv = reqs.filter((r) => r.setDataValidation)
    expect(dv).toHaveLength(CHANNELS.length + 2)
  })

  it('adds exactly four channel colour rules over the C:G block', () => {
    const channelRules = reqs
      .filter((r) => r.addConditionalFormatRule)
      .map((r) => r.addConditionalFormatRule.rule)
      .filter((rule: any) => rule.ranges[0].startColumnIndex === 2 && rule.ranges[0].endColumnIndex === 7)
    expect(channelRules).toHaveLength(4)
    for (const rule of channelRules) {
      expect(rule.booleanRule.condition.type).toBe('CUSTOM_FORMULA')
    }
  })

  it('targets the sheet id it was given', () => {
    for (const r of reqs) {
      const target = r.updateSheetProperties?.properties?.sheetId
        ?? r.setDataValidation?.range?.sheetId
        ?? r.repeatCell?.range?.sheetId
        ?? r.addConditionalFormatRule?.rule?.ranges?.[0]?.sheetId
        ?? r.updateDimensionProperties?.range?.sheetId
      if (target !== undefined) expect(target).toBe(42)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run test/sheets/template.test.ts`
Expected: FAIL — cannot resolve `sheetTemplate.js`.

- [ ] **Step 3: Write the implementation**

Create `server/src/sheets/sheetTemplate.ts`:

```ts
import { ALL_COLUMNS } from '../export/csv.js'

/**
 * Single source of truth for how an Atlas lead tab looks. Mirrors the role
 * selectors.ts plays for the Maps DOM: when the design or the outreach
 * vocabulary changes, this is the only file that changes.
 */

const rgb = (hex: string) => ({
  red: parseInt(hex.slice(1, 3), 16) / 255,
  green: parseInt(hex.slice(3, 5), 16) / 255,
  blue: parseInt(hex.slice(5, 7), 16) / 255,
})

const NAVY = '#0f142d'
const HEADER_BORDER = '#2a3358'
const BODY_FG = '#33333f'

export const STAGE_VALUES = [
  'New', 'Contacted', 'Interested', 'Demo Booked', 'Trial Active',
  'Closed-Won', 'Closed-Lost', 'Not Interested', 'DNC',
]

const STAGE_COLOURS: Record<string, [string, string]> = {
  'New':            ['#e5e5e5', '#000000'],
  'Contacted':      ['#b2b2b2', '#000000'],
  'Interested':     ['#ffbf00', '#ffffff'],
  'Demo Booked':    ['#4c00cc', '#ffffff'],
  'Trial Active':   ['#0066cc', '#ffffff'],
  'Closed-Won':     ['#218c21', '#ffffff'],
  'Closed-Lost':    ['#d83333', '#ffffff'],
  'Not Interested': ['#e57f19', '#ffffff'],
  'DNC':            ['#7f1919', '#ffffff'],
}

export const PRIORITY_VALUES = ['1', '2', '3', '4']
const PRIORITY_COLOURS = ['#db1414', '#f2720c', '#f2cc0c', '#7fb2e5']

/**
 * Channel columns are named "<X> Status" rather than "Facebook"/"Instagram"/"LinkedIn"
 * because Business already has facebook/instagram/linkedin URL fields and header
 * matching is case-insensitive — the obvious names would collide.
 */
export const CHANNELS = [
  { header: 'Call Status', prefix: 'Call',
    values: ['No Answer', 'Voicemail', 'Answered', 'Interested', 'Not Interested', 'Callback', 'Wrong Number', 'DNC'] },
  { header: 'SMS Status', prefix: 'SMS',
    values: ['Sent', 'Delivered', 'Replied', 'Opted Out'] },
  { header: 'FB Status', prefix: 'FB',
    values: ['Request Sent', 'Accepted', 'DM Sent', 'Replied', 'Ignored'] },
  { header: 'IG Status', prefix: 'IG',
    values: ['Followed', 'DM Sent', 'Replied', 'Ignored'] },
  { header: 'LI Status', prefix: 'LI',
    values: ['Request Sent', 'Accepted', 'InMail Sent', 'Replied', 'Ignored'] },
]

/** Outcome buckets, so five channels need four colour rules instead of twenty-six. */
const OUTCOME_COLOURS: { values: string[]; bg: string; fg: string }[] = [
  { values: ['Replied', 'Interested', 'Accepted', 'Answered'], bg: '#218c21', fg: '#ffffff' },
  { values: ['Sent', 'Request Sent', 'DM Sent', 'InMail Sent', 'Delivered', 'Followed', 'Callback'], bg: '#ffbf00', fg: '#ffffff' },
  { values: ['Not Interested', 'Opted Out', 'DNC', 'Wrong Number', 'Ignored'], bg: '#d83333', fg: '#ffffff' },
  { values: ['No Answer', 'Voicemail'], bg: '#b2b2b2', fg: '#000000' },
]

/** The nine CRM columns, in sheet order, that sit between `name` and the Atlas fields. */
export const CRM_HEADERS = [
  'Stage', ...CHANNELS.map((c) => c.header), 'Outreach', 'Priority', 'Notes',
]

/** Headers that must never be treated as an Atlas field, whatever they are called. */
export const RESERVED_HEADERS = [...CRM_HEADERS]

/** name, then the CRM block, then the remaining Atlas fields. */
export const TEMPLATE_HEADERS: string[] = [
  'name',
  ...CRM_HEADERS,
  ...ALL_COLUMNS.filter((c) => c !== 'name').map(String),
]

export const OUTREACH_COLUMN_INDEX = TEMPLATE_HEADERS.indexOf('Outreach')

/**
 * One whole-column array formula, so rows appended by Atlas populate themselves.
 * Written once at H2; Atlas must never write a value into this column.
 */
export const OUTREACH_FORMULA =
  '=ARRAYFORMULA(IF(A2:A="","",REGEXREPLACE(' +
  CHANNELS.map((c, i) => {
    const col = String.fromCharCode(67 + i) // C, D, E, F, G
    return `IF(${col}2:${col}="","","${c.prefix}: "&${col}2:${col}&" · ")`
  }).join('&') +
  ',"( · )+$","")))'

const COLUMN_WIDTHS = [
  250,                       // name
  120,                       // Stage
  110, 110, 110, 110, 110,   // five channels
  260,                       // Outreach
  72,                        // Priority
  280,                       // Notes
]

const border = (color: string) => Object.fromEntries(
  ['top', 'bottom', 'left', 'right'].map((k) => [k, { style: 'SOLID', color: rgb(color) }]),
)

/** Everything needed to turn a bare tab into a styled Atlas lead tab. */
export function buildTemplateRequests(sheetId: number): unknown[] {
  const width = TEMPLATE_HEADERS.length
  const reqs: unknown[] = []

  // Header row
  reqs.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: width },
      cell: {
        userEnteredFormat: {
          backgroundColor: rgb(NAVY),
          horizontalAlignment: 'CENTER',
          verticalAlignment: 'MIDDLE',
          wrapStrategy: 'CLIP',
          textFormat: { foregroundColor: rgb('#ffffff'), bold: true, fontSize: 11 },
          borders: border(HEADER_BORDER),
        },
      },
      fields: 'userEnteredFormat',
    },
  })

  // Body rows
  reqs.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 0, endColumnIndex: width },
      cell: {
        userEnteredFormat: {
          verticalAlignment: 'MIDDLE',
          wrapStrategy: 'CLIP',
          textFormat: { foregroundColor: rgb(BODY_FG), fontSize: 10, bold: false },
        },
      },
      fields: 'userEnteredFormat(verticalAlignment,wrapStrategy,textFormat)',
    },
  })

  // Stage + channels centred
  reqs.push({
    repeatCell: {
      range: { sheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 1, endColumnIndex: 7 },
      cell: { userEnteredFormat: { horizontalAlignment: 'CENTER' } },
      fields: 'userEnteredFormat.horizontalAlignment',
    },
  })

  // Freeze header row and name column
  reqs.push({
    updateSheetProperties: {
      properties: {
        sheetId,
        gridProperties: { frozenRowCount: 1, frozenColumnCount: 1 },
        tabColor: rgb(NAVY),
      },
      fields: 'gridProperties.frozenRowCount,gridProperties.frozenColumnCount,tabColor',
    },
  })

  // Column widths
  COLUMN_WIDTHS.forEach((pixelSize, i) => reqs.push({
    updateDimensionProperties: {
      range: { sheetId, dimension: 'COLUMNS', startIndex: i, endIndex: i + 1 },
      properties: { pixelSize },
      fields: 'pixelSize',
    },
  }))

  // Dropdowns: Stage (B), each channel (C..G), Priority (I)
  const dropdown = (colIndex: number, values: string[]) => ({
    setDataValidation: {
      range: { sheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: colIndex, endColumnIndex: colIndex + 1 },
      rule: {
        condition: { type: 'ONE_OF_LIST', values: values.map((v) => ({ userEnteredValue: v })) },
        strict: true,
        showCustomUi: true,
      },
    },
  })
  reqs.push(dropdown(1, STAGE_VALUES))
  CHANNELS.forEach((c, i) => reqs.push(dropdown(2 + i, c.values)))
  reqs.push(dropdown(TEMPLATE_HEADERS.indexOf('Priority'), PRIORITY_VALUES))

  // Stage colours
  let ruleIndex = 0
  for (const value of STAGE_VALUES) {
    const [bg, fg] = STAGE_COLOURS[value]
    reqs.push({
      addConditionalFormatRule: {
        index: ruleIndex++,
        rule: {
          ranges: [{ sheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 1, endColumnIndex: 2 }],
          booleanRule: {
            condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: value }] },
            format: { backgroundColor: rgb(bg), textFormat: { foregroundColor: rgb(fg), bold: true } },
          },
        },
      },
    })
  }

  // Four outcome rules spanning the whole C:G channel block
  for (const oc of OUTCOME_COLOURS) {
    const list = oc.values.map((v) => `"${v}"`).join(',')
    reqs.push({
      addConditionalFormatRule: {
        index: ruleIndex++,
        rule: {
          ranges: [{ sheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: 2, endColumnIndex: 7 }],
          booleanRule: {
            condition: { type: 'CUSTOM_FORMULA', values: [{ userEnteredValue: `=MATCH(C2,{${list}},0)` }] },
            format: { backgroundColor: rgb(oc.bg), textFormat: { foregroundColor: rgb(oc.fg), bold: true } },
          },
        },
      },
    })
  }

  // Priority colours
  const priorityCol = TEMPLATE_HEADERS.indexOf('Priority')
  PRIORITY_VALUES.forEach((value, i) => reqs.push({
    addConditionalFormatRule: {
      index: ruleIndex++,
      rule: {
        ranges: [{ sheetId, startRowIndex: 1, endRowIndex: 1000, startColumnIndex: priorityCol, endColumnIndex: priorityCol + 1 }],
        booleanRule: {
          condition: { type: 'TEXT_EQ', values: [{ userEnteredValue: value }] },
          format: { backgroundColor: rgb(PRIORITY_COLOURS[i]), textFormat: { foregroundColor: rgb('#ffffff'), bold: true } },
        },
      },
    },
  }))

  return reqs
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run test/sheets/template.test.ts`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/sheets/sheetTemplate.ts server/test/sheets/template.test.ts
git commit -m "feat: sheet template as styling single source of truth

Defines the 34-column lead tab: Stage, five channel status columns, a
derived Outreach summary, Priority and Notes, then the Atlas fields.

Channel colouring uses four CUSTOM_FORMULA rules matched on outcome
semantics across the whole C:G block rather than 26 per-value rules, so
adding a sixth channel needs no new rules.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Header mapping

The heart of "preserve the sheet's structure": never assume positions, map by header name, and never touch a CRM column.

**Files:**
- Create: `server/src/sheets/mapping.ts`
- Create: `server/test/sheets/mapping.test.ts`

**Interfaces:**
- Consumes: `RESERVED_HEADERS`, `TEMPLATE_HEADERS` (Task 4); `ALL_COLUMNS` from `../export/csv.js`; `Business` from `../types.js`.
- Produces:
  - `interface HeaderMap { width: number; fields: (keyof Business | null)[]; stageIndex: number; outreachIndex: number; mapsUrlIndex: number; nameIndex: number; addressIndex: number }`
  - `buildHeaderMap(headerRow: string[]): HeaderMap`
  - `businessToRow(b: Business, map: HeaderMap): string[]`
  - `columnLetter(index: number): string`

- [ ] **Step 1: Write the failing test**

Create `server/test/sheets/mapping.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildHeaderMap, businessToRow, columnLetter } from '../../src/sheets/mapping.js'
import { TEMPLATE_HEADERS } from '../../src/sheets/sheetTemplate.js'
import { Business } from '../../src/types.js'

const business = (over: Partial<Business> = {}): Business => ({
  placeId: 'p1', name: 'The Plumbers', address: '4637 SW 75th Ave', phone: '+1 305-697-3490',
  website: 'https://x.com', rating: 4.9, reviewCount: 86, priceLevel: '', category: 'Plumber',
  hours: 'Open 24 hours', email: '', mapsUrl: 'https://maps/!19sABC', keyword: 'plumber',
  location: 'Miami', facebook: 'https://facebook.com/theplumbers', instagram: '', twitter: '',
  linkedin: 'https://linkedin.com/co', youtube: '', tiktok: '', yelp: '', yellowpages: '',
  ownerName: '', ownerTitle: '', ownerSource: '', ...over,
})

describe('columnLetter', () => {
  it('maps single-letter columns', () => {
    expect(columnLetter(0)).toBe('A')
    expect(columnLetter(25)).toBe('Z')
  })
  it('maps double-letter columns', () => {
    expect(columnLetter(26)).toBe('AA')
    expect(columnLetter(33)).toBe('AH')
  })
})

describe('buildHeaderMap', () => {
  it('maps Atlas headers to their column index', () => {
    const map = buildHeaderMap(['name', 'address', 'phone'])
    expect(map.fields).toEqual(['name', 'address', 'phone'])
    expect(map.width).toBe(3)
  })

  it('is case-insensitive and ignores surrounding whitespace', () => {
    expect(buildHeaderMap(['  NAME ', 'Address']).fields).toEqual(['name', 'address'])
  })

  it('leaves CRM columns unmapped', () => {
    const map = buildHeaderMap(['name', 'Stage', 'Notes', 'address'])
    expect(map.fields).toEqual(['name', null, null, 'address'])
  })

  it('never maps FB Status onto the facebook URL field', () => {
    const map = buildHeaderMap(['name', 'FB Status', 'facebook'])
    expect(map.fields).toEqual(['name', null, 'facebook'])
  })

  it('leaves unknown headers unmapped', () => {
    expect(buildHeaderMap(['name', 'Whatever']).fields).toEqual(['name', null])
  })

  it('records the index of the columns the exporter needs', () => {
    const map = buildHeaderMap(TEMPLATE_HEADERS)
    expect(map.stageIndex).toBe(1)
    expect(map.outreachIndex).toBe(7)
    expect(map.nameIndex).toBe(0)
    expect(TEMPLATE_HEADERS[map.mapsUrlIndex]).toBe('mapsUrl')
  })

  it('reports -1 when an expected column is absent', () => {
    const map = buildHeaderMap(['name', 'address'])
    expect(map.stageIndex).toBe(-1)
    expect(map.mapsUrlIndex).toBe(-1)
  })
})

describe('businessToRow', () => {
  it('produces a row exactly as wide as the header', () => {
    const map = buildHeaderMap(TEMPLATE_HEADERS)
    expect(businessToRow(business(), map)).toHaveLength(TEMPLATE_HEADERS.length)
  })

  it('places values in the mapped positions', () => {
    const map = buildHeaderMap(['name', 'phone', 'address'])
    expect(businessToRow(business(), map))
      .toEqual(['The Plumbers', '+1 305-697-3490', '4637 SW 75th Ave'])
  })

  it('seeds Stage to New', () => {
    const map = buildHeaderMap(TEMPLATE_HEADERS)
    expect(businessToRow(business(), map)[map.stageIndex]).toBe('New')
  })

  it('writes empty into the Outreach column so the ARRAYFORMULA survives', () => {
    const map = buildHeaderMap(TEMPLATE_HEADERS)
    expect(businessToRow(business(), map)[map.outreachIndex]).toBe('')
  })

  it('leaves other CRM columns blank', () => {
    const map = buildHeaderMap(['name', 'Priority', 'Notes'])
    expect(businessToRow(business(), map)).toEqual(['The Plumbers', '', ''])
  })

  it('puts the facebook URL in the facebook column, not FB Status', () => {
    const map = buildHeaderMap(['FB Status', 'facebook'])
    expect(businessToRow(business(), map)).toEqual(['', 'https://facebook.com/theplumbers'])
  })

  it('renders null numerics as empty strings', () => {
    const map = buildHeaderMap(['rating', 'reviewCount'])
    expect(businessToRow(business({ rating: null, reviewCount: null }), map)).toEqual(['', ''])
  })

  it('stringifies numbers', () => {
    const map = buildHeaderMap(['rating'])
    expect(businessToRow(business({ rating: 4.9 }), map)).toEqual(['4.9'])
  })

  it('strips icon glyphs defensively', () => {
    const map = buildHeaderMap(['address'])
    expect(businessToRow(business({ address: '\ue0c8 4637 SW 75th Ave' }), map))
      .toEqual(['4637 SW 75th Ave'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run test/sheets/mapping.test.ts`
Expected: FAIL — cannot resolve `mapping.js`.

- [ ] **Step 3: Write the implementation**

Create `server/src/sheets/mapping.ts`:

```ts
import { Business } from '../types.js'
import { ALL_COLUMNS } from '../export/csv.js'
import { RESERVED_HEADERS } from './sheetTemplate.js'
import { cleanText } from '../scraper/listingParser.js'

export interface HeaderMap {
  /** Number of columns in the target tab's header row. */
  width: number
  /** Per column: the Business field to write there, or null to leave alone. */
  fields: (keyof Business | null)[]
  stageIndex: number
  outreachIndex: number
  mapsUrlIndex: number
  nameIndex: number
  addressIndex: number
}

/** 0 -> A, 25 -> Z, 26 -> AA. */
export function columnLetter(index: number): string {
  let n = index
  let out = ''
  do {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return out
}

const norm = (s: string) => s.trim().toLowerCase()

const ATLAS_BY_NAME = new Map<string, keyof Business>(
  ALL_COLUMNS.map((c) => [norm(String(c)), c]),
)
const RESERVED = new Set(RESERVED_HEADERS.map(norm))

/**
 * Resolve the target tab's header row to Business fields by NAME, never by position,
 * so a tab with extra or reordered columns still works.
 *
 * Reserved CRM headers win over any Atlas match: "FB Status" must never be treated as
 * the `facebook` URL field, and the reserved set is checked first for that reason.
 */
export function buildHeaderMap(headerRow: string[]): HeaderMap {
  const fields = headerRow.map((h) => {
    const key = norm(h)
    if (RESERVED.has(key)) return null
    return ATLAS_BY_NAME.get(key) ?? null
  })
  const indexOfHeader = (name: string) => headerRow.findIndex((h) => norm(h) === norm(name))
  return {
    width: headerRow.length,
    fields,
    stageIndex: indexOfHeader('Stage'),
    outreachIndex: indexOfHeader('Outreach'),
    mapsUrlIndex: fields.indexOf('mapsUrl'),
    nameIndex: fields.indexOf('name'),
    addressIndex: fields.indexOf('address'),
  }
}

/** Build one sheet row for a business, at exactly the header's width. */
export function businessToRow(b: Business, map: HeaderMap): string[] {
  const row: string[] = new Array(map.width).fill('')
  map.fields.forEach((field, i) => {
    if (!field) return
    const v = b[field]
    row[i] = v === null || v === undefined ? '' : cleanText(String(v))
  })
  // New leads enter the pipeline as New so they appear in the dashboard's New bucket.
  if (map.stageIndex >= 0) row[map.stageIndex] = 'New'
  // The Outreach column holds a whole-column ARRAYFORMULA — writing anything
  // non-empty into it would break the formula for every row.
  if (map.outreachIndex >= 0) row[map.outreachIndex] = ''
  return row
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run test/sheets/mapping.test.ts`
Expected: PASS, 18 tests.

- [ ] **Step 5: Commit**

```bash
git add server/src/sheets/mapping.ts server/test/sheets/mapping.test.ts
git commit -m "feat: map Atlas fields onto sheet columns by header name

Reserved CRM headers are resolved before Atlas fields so 'FB Status'
cannot collide with the 'facebook' URL field under case-insensitive
matching. Stage is seeded to New; Outreach is always written empty to
protect its whole-column ARRAYFORMULA.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Exporter orchestration

**Files:**
- Create: `server/src/sheets/exporter.ts`
- Create: `server/test/sheets/exporter.test.ts`

**Interfaces:**
- Consumes: `SheetsClient` (Task 3), `buildHeaderMap`/`businessToRow`/`columnLetter` (Task 5), `TEMPLATE_HEADERS`/`buildTemplateRequests`/`OUTREACH_FORMULA` (Task 4), `placeIdFromUrl` from `../scraper/listingParser.js`.
- Produces:
  - `class ExportError extends Error { status: number }`
  - `interface ExportOptions { spreadsheetId: string; sheetTitle: string; createNew?: boolean }`
  - `interface ExporterDeps { client: SheetsClient; iterate: (batch: number) => Generator<Business[]>; count: () => number; maxRows?: number }`
  - `exportToSheet(deps: ExporterDeps, opts: ExportOptions): Promise<ExportResult>`
  - `MAX_EXPORT_ROWS = 50000`

- [ ] **Step 1: Write the failing test**

Create `server/test/sheets/exporter.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { exportToSheet, ExportError, MAX_EXPORT_ROWS } from '../../src/sheets/exporter.js'
import { TEMPLATE_HEADERS } from '../../src/sheets/sheetTemplate.js'
import { Business } from '../../src/types.js'

const business = (i: number, over: Partial<Business> = {}): Business => ({
  placeId: `p${i}`, name: `Biz ${i}`, address: `${i} Main St`, phone: `+1 305-000-000${i}`,
  website: '', rating: null, reviewCount: null, priceLevel: '', category: 'Plumber',
  hours: '', email: '', mapsUrl: `https://maps/x/data=!19sPLACE${i}`, keyword: 'plumber',
  location: 'Miami', facebook: '', instagram: '', twitter: '', linkedin: '', youtube: '',
  tiktok: '', yelp: '', yellowpages: '', ownerName: '', ownerTitle: '', ownerSource: '', ...over,
})

function fakeClient(over: Record<string, unknown> = {}) {
  return {
    getTabs: vi.fn(async () => [{ sheetId: 5, title: 'Faizan', rowCount: 1000 }]),
    getValues: vi.fn(async () => [TEMPLATE_HEADERS]),
    appendValues: vi.fn(async () => undefined),
    updateValues: vi.fn(async () => undefined),
    batchUpdate: vi.fn(async () => ({ replies: [{ addSheet: { properties: { sheetId: 99 } } }] })),
    ...over,
  }
}

function deps(rows: Business[], client = fakeClient()) {
  return {
    client: client as never,
    count: () => rows.length,
    iterate: function* (batch: number) {
      for (let i = 0; i < rows.length; i += batch) yield rows.slice(i, i + batch)
    },
  }
}

describe('exportToSheet', () => {
  it('appends every row when the tab is empty of data', async () => {
    const client = fakeClient()
    const result = await exportToSheet(deps([business(1), business(2)], client),
      { spreadsheetId: 'sid', sheetTitle: 'Faizan' })
    expect(result).toEqual({ appended: 2, skipped: 0, total: 2 })
    expect(client.appendValues).toHaveBeenCalledTimes(1)
  })

  it('skips businesses whose placeId is already in the sheet', async () => {
    const mapsUrlCol = TEMPLATE_HEADERS.indexOf('mapsUrl')
    const existing = new Array(TEMPLATE_HEADERS.length).fill('')
    existing[mapsUrlCol] = 'https://maps/y/data=!19sPLACE1'
    const client = fakeClient({ getValues: vi.fn(async () => [TEMPLATE_HEADERS, existing]) })
    const result = await exportToSheet(deps([business(1), business(2)], client),
      { spreadsheetId: 'sid', sheetTitle: 'Faizan' })
    expect(result).toEqual({ appended: 1, skipped: 1, total: 2 })
  })

  it('writes rows at the header width', async () => {
    const client = fakeClient()
    await exportToSheet(deps([business(1)], client), { spreadsheetId: 'sid', sheetTitle: 'Faizan' })
    const [, , values] = client.appendValues.mock.calls[0]
    expect((values as string[][])[0]).toHaveLength(TEMPLATE_HEADERS.length)
  })

  it('never appends when every row is a duplicate', async () => {
    const mapsUrlCol = TEMPLATE_HEADERS.indexOf('mapsUrl')
    const existing = new Array(TEMPLATE_HEADERS.length).fill('')
    existing[mapsUrlCol] = 'https://maps/y/data=!19sPLACE1'
    const client = fakeClient({ getValues: vi.fn(async () => [TEMPLATE_HEADERS, existing]) })
    const result = await exportToSheet(deps([business(1)], client),
      { spreadsheetId: 'sid', sheetTitle: 'Faizan' })
    expect(result).toEqual({ appended: 0, skipped: 1, total: 1 })
    expect(client.appendValues).not.toHaveBeenCalled()
  })

  it('rejects before writing anything when over the row cap', async () => {
    const client = fakeClient()
    const d = { ...deps([business(1)], client), count: () => MAX_EXPORT_ROWS + 1 }
    await expect(exportToSheet(d, { spreadsheetId: 'sid', sheetTitle: 'Faizan' }))
      .rejects.toMatchObject({ status: 413 })
    expect(client.appendValues).not.toHaveBeenCalled()
  })

  it('builds the full template when the target tab is entirely empty', async () => {
    const client = fakeClient({ getValues: vi.fn(async () => []) })
    await exportToSheet(deps([business(1)], client), { spreadsheetId: 'sid', sheetTitle: 'Faizan' })
    expect(client.batchUpdate).toHaveBeenCalled()
    // header row written, and the ARRAYFORMULA installed at the Outreach column
    const ranges = client.updateValues.mock.calls.map((c) => c[1])
    expect(ranges.some((r) => String(r).includes('A1'))).toBe(true)
    expect(ranges.some((r) => String(r).includes('H2'))).toBe(true)
  })

  it('creates a new tab when asked', async () => {
    const client = fakeClient({ getTabs: vi.fn(async () => []), getValues: vi.fn(async () => []) })
    await exportToSheet(deps([business(1)], client),
      { spreadsheetId: 'sid', sheetTitle: 'Bilal', createNew: true })
    const addSheetCall = client.batchUpdate.mock.calls
      .flatMap((c) => c[1] as Record<string, any>[])
      .find((r) => r.addSheet)
    expect(addSheetCall.addSheet.properties.title).toBe('Bilal')
  })

  it('fails clearly when the tab does not exist and createNew is not set', async () => {
    const client = fakeClient({ getTabs: vi.fn(async () => []) })
    await expect(exportToSheet(deps([business(1)], client),
      { spreadsheetId: 'sid', sheetTitle: 'Nope' })).rejects.toThrow(/not found/i)
  })

  it('batches large exports into multiple append calls', async () => {
    const client = fakeClient()
    const rows = Array.from({ length: 12000 }, (_, i) => business(i))
    const result = await exportToSheet(deps(rows, client), { spreadsheetId: 'sid', sheetTitle: 'Faizan' })
    expect(result.appended).toBe(12000)
    expect(client.appendValues).toHaveBeenCalledTimes(3) // 5000 + 5000 + 2000
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run test/sheets/exporter.test.ts`
Expected: FAIL — cannot resolve `exporter.js`.

- [ ] **Step 3: Write the implementation**

Create `server/src/sheets/exporter.ts`:

```ts
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
async function buildTab(client: SheetsClient, spreadsheetId: string, sheetTitle: string, sheetId: number): Promise<string[]> {
  await client.updateValues(spreadsheetId, `'${sheetTitle}'!A1`, [TEMPLATE_HEADERS])
  await client.batchUpdate(spreadsheetId, buildTemplateRequests(sheetId))
  // USER_ENTERED so this lands as a formula, not literal text.
  const outreachCol = columnLetter(TEMPLATE_HEADERS.indexOf('Outreach'))
  await client.updateValues(spreadsheetId, `'${sheetTitle}'!${outreachCol}2`, [[OUTREACH_FORMULA]])
  return TEMPLATE_HEADERS
}

export async function exportToSheet(deps: ExporterDeps, opts: ExportOptions): Promise<ExportResult> {
  const { client, spreadsheetId = opts.spreadsheetId } = { client: deps.client, spreadsheetId: opts.spreadsheetId }
  const cap = deps.maxRows ?? MAX_EXPORT_ROWS
  const total = deps.count()

  // Check the cap before any write, so we never leave a half-populated sheet.
  if (total > cap) {
    throw new ExportError(
      `${total.toLocaleString()} rows exceeds the Google Sheets export limit of ${cap.toLocaleString()}. Use Export CSV instead.`,
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run test/sheets/exporter.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Simplify the accidental destructuring**

The first line of `exportToSheet` is needlessly convoluted. Replace it with:

```ts
  const client = deps.client
  const spreadsheetId = opts.spreadsheetId
```

- [ ] **Step 6: Re-run the suite**

Run: `cd server && npx vitest run test/sheets/`
Expected: PASS, all sheets tests.

- [ ] **Step 7: Commit**

```bash
git add server/src/sheets/exporter.ts server/test/sheets/exporter.test.ts
git commit -m "feat: batched Sheets exporter with placeId dedup

Streams from SQLite in 5000-row append batches so memory stays bounded.
Dedups against rows already in the tab using the placeId embedded in
mapsUrl. Enforces the 50k row cap before any write so a rejected export
never leaves a half-populated sheet.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: API routes and wiring

**Files:**
- Modify: `server/src/api/routes.ts`
- Modify: `server/src/index.ts`
- Test: `server/test/routes.test.ts`

**Interfaces:**
- Consumes: `SpreadsheetRef`, `TabRef`, `ExportResult` (Task 3); `exportToSheet`, `ExportError` (Task 6); `SheetsAuth` (Task 2); `SheetsClient` (Task 3).
- Produces: `RouteDeps.sheets` —
  ```ts
  sheets: {
    configured: () => boolean
    clientEmail: () => string
    listSpreadsheets: () => Promise<SpreadsheetRef[]>
    listTabs: (spreadsheetId: string) => Promise<TabRef[]>
    exportTo: (spreadsheetId: string, sheetTitle: string, createNew: boolean) => Promise<ExportResult>
  }
  ```

- [ ] **Step 1: Write the failing test**

Append to `server/test/routes.test.ts` (keep its existing imports; add `createApp` if not already imported):

```ts
describe('sheets routes', () => {
  const baseDeps = () => ({
    geo: {
      countries: () => [], states: () => [], cities: () => [],
      zips: async () => [],
    },
    results: {
      page: () => [], count: () => 0,
      iterate: function* () {}, clear: () => {},
    },
    startJob: () => {}, stopJob: () => {},
    sheets: {
      configured: () => true,
      clientEmail: () => 'svc@example.iam.gserviceaccount.com',
      listSpreadsheets: async () => [{ id: 'a', name: 'Plumber leads' }],
      listTabs: async () => [{ sheetId: 1, title: 'Faizan', rowCount: 51 }],
      exportTo: async () => ({ appended: 112, skipped: 38, total: 150 }),
    },
  })

  it('lists spreadsheets', async () => {
    const res = await request(createApp(baseDeps() as never)).get('/api/sheets/spreadsheets')
    expect(res.status).toBe(200)
    expect(res.body).toEqual([{ id: 'a', name: 'Plumber leads' }])
  })

  it('lists tabs for a spreadsheet', async () => {
    const res = await request(createApp(baseDeps() as never)).get('/api/sheets/abc/tabs')
    expect(res.status).toBe(200)
    expect(res.body[0].title).toBe('Faizan')
  })

  it('reports 503 with the share-with address when unconfigured', async () => {
    const deps = baseDeps()
    deps.sheets.configured = () => true
    deps.sheets.clientEmail = () => 'svc@example.iam.gserviceaccount.com'
    const unconfigured = { ...deps, sheets: { ...deps.sheets, configured: () => false } }
    const res = await request(createApp(unconfigured as never)).get('/api/sheets/spreadsheets')
    expect(res.status).toBe(503)
    expect(res.body.error).toMatch(/not configured/i)
  })

  it('exports and returns the summary', async () => {
    const res = await request(createApp(baseDeps() as never))
      .post('/api/export/sheets')
      .send({ spreadsheetId: 'abc', sheetTitle: 'Faizan' })
    expect(res.status).toBe(200)
    expect(res.body).toEqual({ appended: 112, skipped: 38, total: 150 })
  })

  it('rejects an export with no spreadsheetId', async () => {
    const res = await request(createApp(baseDeps() as never))
      .post('/api/export/sheets').send({ sheetTitle: 'Faizan' })
    expect(res.status).toBe(400)
  })

  it('surfaces the service-account address on a 403 from Google', async () => {
    const deps = baseDeps()
    deps.sheets.exportTo = async () => { throw Object.assign(new Error('denied'), { status: 403 }) }
    const res = await request(createApp(deps as never))
      .post('/api/export/sheets').send({ spreadsheetId: 'abc', sheetTitle: 'Faizan' })
    expect(res.status).toBe(403)
    expect(res.body.shareWith).toBe('svc@example.iam.gserviceaccount.com')
  })

  it('passes the row-cap status through', async () => {
    const deps = baseDeps()
    deps.sheets.exportTo = async () => { throw Object.assign(new Error('too many'), { status: 413 }) }
    const res = await request(createApp(deps as never))
      .post('/api/export/sheets').send({ spreadsheetId: 'abc', sheetTitle: 'Faizan' })
    expect(res.status).toBe(413)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run test/routes.test.ts`
Expected: FAIL — 404s, because the routes do not exist.

- [ ] **Step 3: Extend RouteDeps**

In `server/src/api/routes.ts`, add to the imports:

```ts
import { Business, JobSettings, LocationSpec, ResultQuery, SpreadsheetRef, TabRef, ExportResult, normalizeSettings } from '../types.js'
```

and add this member to the `RouteDeps` interface, after `stopJob`:

```ts
  sheets: {
    configured: () => boolean
    clientEmail: () => string
    listSpreadsheets: () => Promise<SpreadsheetRef[]>
    listTabs: (spreadsheetId: string) => Promise<TabRef[]>
    exportTo: (spreadsheetId: string, sheetTitle: string, createNew: boolean) => Promise<ExportResult>
  }
```

- [ ] **Step 4: Add the routes**

In `createApp`, insert before `return app`:

```ts
  // --- Google Sheets export -------------------------------------------------
  // A 403 from Google almost always means "the sheet isn't shared with the
  // service account", so every failure path carries the address to share with.
  const sheetsError = (res: express.Response, e: unknown) => {
    const status = (e as { status?: number }).status ?? 500
    const error = e instanceof Error ? e.message : 'Google Sheets request failed'
    res.status(status).json({ error, shareWith: deps.sheets.clientEmail() })
  }

  const requireConfigured = (res: express.Response): boolean => {
    if (deps.sheets.configured()) return true
    res.status(503).json({ error: 'Google Sheets export is not configured on the server.' })
    return false
  }

  app.get('/api/sheets/spreadsheets', async (_req, res) => {
    if (!requireConfigured(res)) return
    try { res.json(await deps.sheets.listSpreadsheets()) } catch (e) { sheetsError(res, e) }
  })

  app.get('/api/sheets/:id/tabs', async (req, res) => {
    if (!requireConfigured(res)) return
    try { res.json(await deps.sheets.listTabs(String(req.params.id))) } catch (e) { sheetsError(res, e) }
  })

  app.post('/api/export/sheets', async (req, res) => {
    if (!requireConfigured(res)) return
    const { spreadsheetId, sheetTitle, createNew } = req.body ?? {}
    if (!spreadsheetId || !sheetTitle) {
      return res.status(400).json({ error: 'spreadsheetId and sheetTitle are both required' })
    }
    try {
      res.json(await deps.sheets.exportTo(String(spreadsheetId), String(sheetTitle), Boolean(createNew)))
    } catch (e) { sheetsError(res, e) }
  })
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && npx vitest run test/routes.test.ts`
Expected: PASS.

- [ ] **Step 6: Wire it up in index.ts**

Add imports to `server/src/index.ts`:

```ts
import { SheetsAuth } from './sheets/auth.js'
import { SheetsClient } from './sheets/client.js'
import { exportToSheet } from './sheets/exporter.js'
```

Add after the `store` construction:

```ts
const sheetsAuth = new SheetsAuth()
const sheetsClient = new SheetsClient(sheetsAuth)
```

Add this member to the `createApp({...})` object, after `stopJob`:

```ts
  sheets: {
    configured: () => sheetsAuth.isConfigured(),
    clientEmail: () => sheetsAuth.clientEmail(),
    listSpreadsheets: () => sheetsClient.listSpreadsheets(),
    listTabs: (id: string) => sheetsClient.getTabs(id),
    exportTo: (spreadsheetId: string, sheetTitle: string, createNew: boolean) =>
      exportToSheet(
        { client: sheetsClient, iterate: (b) => store.iterateAll(b), count: () => store.count({}) },
        { spreadsheetId, sheetTitle, createNew },
      ),
  },
```

- [ ] **Step 7: Typecheck and run the full suite**

Run: `cd server && npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass.

- [ ] **Step 8: Commit**

```bash
git add server/src/api/routes.ts server/src/index.ts server/test/routes.test.ts
git commit -m "feat: Sheets export API routes

Three routes behind a RouteDeps.sheets interface so handlers stay
testable with a fake. Every error response carries the service-account
address, since a 403 nearly always means the sheet was not shared.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Frontend API client and types

**Files:**
- Modify: `web/src/lib/types.ts`
- Modify: `web/src/lib/api.ts`

**Interfaces:**
- Consumes: the routes from Task 7.
- Produces: `api.getSpreadsheets()`, `api.getTabs(id)`, `api.exportToSheet(payload)`; types `SpreadsheetRef`, `TabRef`, `ExportResult`, `SheetsErrorBody`.

- [ ] **Step 1: Mirror the shared types**

Append to `web/src/lib/types.ts` — these must stay identical to `server/src/types.ts`:

```ts
/** A spreadsheet the service account can see (i.e. one shared with it). */
export interface SpreadsheetRef {
  id: string
  name: string
}

/** A tab within a spreadsheet. */
export interface TabRef {
  sheetId: number
  title: string
  rowCount: number
}

/** Outcome of a Sheets export. `total` is rows considered, not rows written. */
export interface ExportResult {
  appended: number
  skipped: number
  total: number
}

/** Error body returned by the /api/sheets/* routes. */
export interface SheetsErrorBody {
  error: string
  shareWith?: string
}
```

- [ ] **Step 2: Add the client methods**

In `web/src/lib/api.ts`, extend the type import:

```ts
import type {
  Business, JobSettings, LocationSpec, ResultQuery,
  SpreadsheetRef, TabRef, ExportResult, SheetsErrorBody,
} from './types'
```

Add this helper above `export const api`:

```ts
/** Throws an Error carrying the parsed body so callers can show `shareWith`. */
async function jsonOrThrow<T>(r: Response): Promise<T> {
  const body = await r.json().catch(() => ({}))
  if (!r.ok) {
    const err = new Error((body as SheetsErrorBody).error ?? `HTTP ${r.status}`)
    Object.assign(err, { status: r.status, shareWith: (body as SheetsErrorBody).shareWith })
    throw err
  }
  return body as T
}
```

Add these members to the `api` object:

```ts
  getSpreadsheets: async () =>
    jsonOrThrow<SpreadsheetRef[]>(await fetch('/api/sheets/spreadsheets')),
  getTabs: async (id: string) =>
    jsonOrThrow<TabRef[]>(await fetch(`/api/sheets/${encodeURIComponent(id)}/tabs`)),
  exportToSheet: async (payload: { spreadsheetId: string; sheetTitle: string; createNew?: boolean }) =>
    jsonOrThrow<ExportResult>(await fetch('/api/export/sheets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })),
```

- [ ] **Step 3: Verify the contract matches the server**

Run:

```bash
cd server && grep -A4 'interface SpreadsheetRef' src/types.ts
cd ../web && grep -A4 'interface SpreadsheetRef' src/lib/types.ts
```

Expected: identical field lists. These files are hand-synced with no codegen — a mismatch silently breaks the wire.

- [ ] **Step 4: Typecheck**

Run: `cd web && npx tsc -b --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/types.ts web/src/lib/api.ts
git commit -m "feat: frontend client for Sheets export routes

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Export dialog

**Files:**
- Create: `web/src/components/ExportDialog.tsx`
- Modify: `web/src/components/TopBar.tsx`

**Interfaces:**
- Consumes: `api.getSpreadsheets`, `api.getTabs`, `api.exportToSheet`, `api.exportCsvUrl` (Task 8).
- Produces: `<ExportDialog open={boolean} onClose={() => void} />`

- [ ] **Step 1: Create the dialog**

Create `web/src/components/ExportDialog.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { SpreadsheetRef, TabRef, ExportResult } from '../lib/types'

type Step = 'destination' | 'spreadsheet' | 'tab' | 'done'

interface Props { open: boolean; onClose: () => void }

export function ExportDialog({ open, onClose }: Props) {
  const [step, setStep] = useState<Step>('destination')
  const [sheets, setSheets] = useState<SpreadsheetRef[]>([])
  const [tabs, setTabs] = useState<TabRef[]>([])
  const [chosen, setChosen] = useState<SpreadsheetRef | null>(null)
  const [newTab, setNewTab] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string; shareWith?: string } | null>(null)
  const [result, setResult] = useState<ExportResult | null>(null)

  // Reset every time the dialog is reopened, so a previous run's state never leaks.
  useEffect(() => {
    if (!open) return
    setStep('destination'); setChosen(null); setTabs([]); setNewTab('')
    setError(null); setResult(null); setBusy(false)
  }, [open])

  if (!open) return null

  const fail = (e: unknown) => {
    const err = e as { message?: string; shareWith?: string }
    setError({ message: err.message ?? 'Something went wrong', shareWith: err.shareWith })
  }

  const chooseSheets = async () => {
    setBusy(true); setError(null)
    try { setSheets(await api.getSpreadsheets()); setStep('spreadsheet') }
    catch (e) { fail(e) } finally { setBusy(false) }
  }

  const chooseSpreadsheet = async (s: SpreadsheetRef) => {
    setBusy(true); setError(null); setChosen(s)
    try { setTabs(await api.getTabs(s.id)); setStep('tab') }
    catch (e) { fail(e) } finally { setBusy(false) }
  }

  const runExport = async (sheetTitle: string, createNew: boolean) => {
    if (!chosen || !sheetTitle.trim()) return
    setBusy(true); setError(null)
    try {
      setResult(await api.exportToSheet({ spreadsheetId: chosen.id, sheetTitle: sheetTitle.trim(), createNew }))
      setStep('done')
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/70 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Export data"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-line bg-ink-900 p-5 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-base font-700 text-parchment">Export data</h2>
          <button onClick={onClose} aria-label="Close" className="text-muted transition hover:text-parchment">✕</button>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-rose/40 bg-rose/10 p-3 text-sm text-rose">
            <p>{error.message}</p>
            {error.shareWith && (
              <p className="mt-2 text-xs text-muted">
                Share the spreadsheet with:{' '}
                <code className="break-all text-parchment">{error.shareWith}</code>
              </p>
            )}
          </div>
        )}

        {step === 'destination' && (
          <div className="space-y-2">
            <a
              href={api.exportCsvUrl()}
              download
              onClick={onClose}
              className="block rounded-md border border-line px-3 py-2.5 text-sm text-parchment transition hover:border-teal hover:text-teal"
            >
              Download CSV
              <span className="block text-xs text-muted">Streamed from disk — works at any size</span>
            </a>
            <button
              onClick={chooseSheets}
              disabled={busy}
              className="block w-full rounded-md border border-line px-3 py-2.5 text-left text-sm text-parchment transition hover:border-teal hover:text-teal disabled:opacity-40"
            >
              {busy ? 'Loading…' : 'Add to a Google Sheet'}
              <span className="block text-xs text-muted">Appends new rows, keeps existing formatting</span>
            </button>
          </div>
        )}

        {step === 'spreadsheet' && (
          <div className="space-y-1">
            <p className="eyebrow mb-2">Choose a spreadsheet</p>
            {sheets.length === 0 && <p className="text-sm text-muted">No spreadsheets are shared with the service account yet.</p>}
            {sheets.map((s) => (
              <button
                key={s.id}
                onClick={() => chooseSpreadsheet(s)}
                disabled={busy}
                className="block w-full rounded-md border border-line px-3 py-2 text-left text-sm text-parchment transition hover:border-teal hover:text-teal disabled:opacity-40"
              >
                {s.name}
              </button>
            ))}
          </div>
        )}

        {step === 'tab' && (
          <div className="space-y-1">
            <p className="eyebrow mb-2">Choose a tab in “{chosen?.name}”</p>
            {tabs.map((t) => (
              <button
                key={t.sheetId}
                onClick={() => runExport(t.title, false)}
                disabled={busy}
                className="flex w-full items-center justify-between rounded-md border border-line px-3 py-2 text-left text-sm text-parchment transition hover:border-teal hover:text-teal disabled:opacity-40"
              >
                <span>{t.title}</span>
                <span className="font-mono text-xs text-muted">{t.rowCount} rows</span>
              </button>
            ))}
            <div className="flex gap-2 pt-2">
              <input
                value={newTab}
                onChange={(e) => setNewTab(e.target.value)}
                placeholder="New tab name…"
                className="flex-1 rounded-md border border-line bg-ink-600/40 px-3 py-2 text-sm text-parchment placeholder:text-muted"
              />
              <button
                onClick={() => runExport(newTab, true)}
                disabled={busy || !newTab.trim()}
                className="rounded-md border border-line px-3 py-2 text-sm text-parchment transition hover:border-teal hover:text-teal disabled:opacity-40"
              >
                Create
              </button>
            </div>
            {busy && <p className="pt-2 text-sm text-muted">Exporting…</p>}
          </div>
        )}

        {step === 'done' && result && (
          <div className="space-y-3">
            <p className="text-sm text-parchment">
              <span className="text-teal">{result.appended.toLocaleString()}</span> rows added
              {result.skipped > 0 && <> · {result.skipped.toLocaleString()} already present</>}
            </p>
            <button
              onClick={onClose}
              className="w-full rounded-md border border-line px-3 py-2 text-sm text-parchment transition hover:border-teal hover:text-teal"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Wire it into TopBar**

In `web/src/components/TopBar.tsx`:

Add to the imports:

```tsx
import { useState } from 'react'
import { ExportDialog } from './ExportDialog'
```

Add inside the component, next to the other hooks:

```tsx
  const [exportOpen, setExportOpen] = useState(false)
```

Replace the `<a href={total ? api.exportCsvUrl() : undefined} …>Export CSV</a>` element (currently lines 79-88) with:

```tsx
        <button
          onClick={() => setExportOpen(true)}
          disabled={!total}
          className="rounded-md border border-line px-3 py-1.5 text-sm font-500 text-parchment transition
                     hover:border-teal hover:text-teal disabled:cursor-not-allowed disabled:opacity-40"
        >
          Export
        </button>
```

Then wrap the returned `<header>…</header>` in a fragment and render the dialog after it:

```tsx
    <>
      <header className="contour relative border-b border-line bg-ink-900/80">
        {/* …unchanged… */}
      </header>
      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
    </>
```

- [ ] **Step 3: Lint and typecheck**

Run: `cd web && npx tsc -b --noEmit && npm run lint`
Expected: no errors.

- [ ] **Step 4: Manual verification**

Start both servers (`cd server && npm run dev`, then `cd web && npm run dev`), run a small scrape so `total > 0`, then:

1. Click **Export** → the dialog opens with two destinations.
2. Click **Download CSV** → a file downloads, dialog closes.
3. Click **Export → Add to a Google Sheet** → "Plumber leads" is listed.
4. Choose it → `Dashboard`, `Faizan`, `Amna` are listed with row counts.
5. Choose `Faizan` → summary shows appended/skipped counts.
6. Open the sheet and confirm: new rows appended below the existing ones, `Stage` shows `New` with grey formatting, `Outreach` is blank (not `#REF!`), and existing rows' `Stage`/`Notes` are unchanged.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ExportDialog.tsx web/src/components/TopBar.tsx
git commit -m "feat: export dialog with CSV and Google Sheets destinations

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Migrate the existing rep tabs

`Faizan` and `Amna` currently have `Status`/`Priority`/`Notes` at B/C/D and 27 columns. They need the 33-column model.

**Files:**
- Create: `server/scripts/migrate-sheet.ts`
- Create: `server/test/sheets/migration.test.ts`

**Interfaces:**
- Consumes: `CHANNELS`, `TEMPLATE_HEADERS` (Task 4); `SheetsClient` (Task 3).
- Produces: `migrateLegacyStatus(status: string): { stage: string; call: string }`

- [ ] **Step 1: Write the failing test**

Create `server/test/sheets/migration.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { migrateLegacyStatus } from '../../scripts/migrate-sheet.js'
import { STAGE_VALUES, CHANNELS } from '../../src/sheets/sheetTemplate.js'

const callValues = CHANNELS[0].values

describe('migrateLegacyStatus', () => {
  it('keeps New as a stage with no call outcome', () => {
    expect(migrateLegacyStatus('New')).toEqual({ stage: 'New', call: '' })
  })

  it('splits a call outcome into stage plus call status', () => {
    expect(migrateLegacyStatus('Called-No Answer')).toEqual({ stage: 'Contacted', call: 'No Answer' })
    expect(migrateLegacyStatus('Called-VM')).toEqual({ stage: 'Contacted', call: 'Voicemail' })
    expect(migrateLegacyStatus('Called-Interested')).toEqual({ stage: 'Interested', call: 'Interested' })
  })

  it('carries deal stages across unchanged', () => {
    for (const s of ['Demo Booked', 'Trial Active', 'Closed-Won', 'Closed-Lost']) {
      expect(migrateLegacyStatus(s)).toEqual({ stage: s, call: '' })
    }
  })

  it('maps rejection states to both stage and call status', () => {
    expect(migrateLegacyStatus('Not Interested')).toEqual({ stage: 'Not Interested', call: 'Not Interested' })
    expect(migrateLegacyStatus('DNC')).toEqual({ stage: 'DNC', call: 'DNC' })
  })

  it('defaults an unrecognised or blank value to New', () => {
    expect(migrateLegacyStatus('')).toEqual({ stage: 'New', call: '' })
    expect(migrateLegacyStatus('Nonsense')).toEqual({ stage: 'New', call: '' })
  })

  it('only ever emits values that exist in the vocabularies', () => {
    for (const legacy of ['New', 'Called-No Answer', 'Called-VM', 'Called-Interested',
      'Demo Booked', 'Trial Active', 'Closed-Won', 'Closed-Lost', 'Not Interested', 'DNC']) {
      const { stage, call } = migrateLegacyStatus(legacy)
      expect(STAGE_VALUES).toContain(stage)
      if (call) expect(callValues).toContain(call)
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run test/sheets/migration.test.ts`
Expected: FAIL — cannot resolve `migrate-sheet.js`.

- [ ] **Step 3: Write the migration script**

Create `server/scripts/migrate-sheet.ts`:

```ts
/**
 * One-off migration: converts a legacy Atlas lead tab (name, Status, Priority, Notes,
 * + 23 Atlas fields) to the five-channel model defined in sheetTemplate.ts.
 *
 * Usage: npx tsx scripts/migrate-sheet.ts <spreadsheetId> <tabTitle> [--dry-run]
 */
import { SheetsAuth } from '../src/sheets/auth.js'
import { SheetsClient } from '../src/sheets/client.js'
import {
  TEMPLATE_HEADERS, CRM_HEADERS, OUTREACH_FORMULA, buildTemplateRequests,
} from '../src/sheets/sheetTemplate.js'
import { columnLetter } from '../src/sheets/mapping.js'

/** Legacy single Status value -> new Stage + Call Status pair. */
export function migrateLegacyStatus(status: string): { stage: string; call: string } {
  switch (status.trim()) {
    case 'Called-No Answer':   return { stage: 'Contacted', call: 'No Answer' }
    case 'Called-VM':          return { stage: 'Contacted', call: 'Voicemail' }
    case 'Called-Interested':  return { stage: 'Interested', call: 'Interested' }
    case 'Demo Booked':        return { stage: 'Demo Booked', call: '' }
    case 'Trial Active':       return { stage: 'Trial Active', call: '' }
    case 'Closed-Won':         return { stage: 'Closed-Won', call: '' }
    case 'Closed-Lost':        return { stage: 'Closed-Lost', call: '' }
    case 'Not Interested':     return { stage: 'Not Interested', call: 'Not Interested' }
    case 'DNC':                return { stage: 'DNC', call: 'DNC' }
    default:                   return { stage: 'New', call: '' }
  }
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

  const statusCol = idx('Status')
  const priorityCol = idx('Priority')
  const notesCol = idx('Notes')
  if (statusCol < 0) throw new Error('No legacy "Status" column found — already migrated?')

  // Rebuild each row against the new header, preserving Priority and Notes.
  const legacyAtlas = header.map((h, i) => ({ h: h.trim(), i }))
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

  console.log(`${tabTitle}: ${migrated.length} rows -> ${TEMPLATE_HEADERS.length} columns`)
  console.log('sample:', JSON.stringify(migrated[0]?.slice(0, 10)))
  if (dryRun) { console.log('dry run — nothing written'); return }

  // Widen the grid, then rewrite header + body, then restyle.
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
  await client.batchUpdate(spreadsheetId, buildTemplateRequests(tab.sheetId))
  const outreachCol = columnLetter(TEMPLATE_HEADERS.indexOf('Outreach'))
  await client.updateValues(spreadsheetId, `'${tabTitle}'!${outreachCol}2`, [[OUTREACH_FORMULA]])
  console.log(`migrated ${tabTitle} (${CRM_HEADERS.length} CRM columns installed)`)
}

// Only run when invoked directly, so the test can import migrateLegacyStatus.
if (process.argv[1]?.includes('migrate-sheet')) {
  main().catch((e) => { console.error(e); process.exit(1) })
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run test/sheets/migration.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Dry-run against the real sheet**

```bash
cd server
npx tsx scripts/migrate-sheet.ts 1mWsyumDg3PiLgVNqE2qxALVbAbGgZ1L4gDKlGKtdDjU Faizan --dry-run
```

Expected: reports `50 rows -> 33 columns` and prints a sample. Nothing written.

- [ ] **Step 6: Migrate both tabs for real**

```bash
npx tsx scripts/migrate-sheet.ts 1mWsyumDg3PiLgVNqE2qxALVbAbGgZ1L4gDKlGKtdDjU Faizan
npx tsx scripts/migrate-sheet.ts 1mWsyumDg3PiLgVNqE2qxALVbAbGgZ1L4gDKlGKtdDjU Amna
```

Then open the spreadsheet and confirm: 33 columns, `Stage` dropdown works, five channel dropdowns work and colour correctly, `Outreach` populates when a channel value is set, and Notes/Priority survived.

> **Note:** the Dashboard tab still references the old `Status` column (`B`) and will show stale numbers until it is rebuilt. That is Task 11.

- [ ] **Step 7: Commit**

```bash
git add server/scripts/migrate-sheet.ts server/test/sheets/migration.test.ts
git commit -m "feat: migrate legacy Status column to five-channel model

Splits the conflated Status column into a pipeline Stage plus a Call
Status, preserving Priority and Notes.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Rebuild the dashboard for the new model

The Dashboard's funnel counts the old `Status` column in `B`, which now holds `Stage`, and its contact rate matched `"Called*"`, which no longer describes four of five channels.

**Files:**
- Create: `server/scripts/rebuild-dashboard.ts`
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: `CHANNELS`, `STAGE_VALUES` (Task 4); `SheetsClient` (Task 3).
- Produces: a rebuilt `Dashboard` tab. No exported API.

- [ ] **Step 1: Write the rebuild script**

Create `server/scripts/rebuild-dashboard.ts`:

```ts
/**
 * Rebuilds the Dashboard tab against the five-channel model.
 * Usage: npx tsx scripts/rebuild-dashboard.ts <spreadsheetId> <repTab> [<repTab> …]
 */
import { SheetsAuth } from '../src/sheets/auth.js'
import { SheetsClient } from '../src/sheets/client.js'
import { CHANNELS, STAGE_VALUES, TEMPLATE_HEADERS } from '../src/sheets/sheetTemplate.js'
import { columnLetter } from '../src/sheets/mapping.js'

const STAGE_COL = columnLetter(TEMPLATE_HEADERS.indexOf('Stage'))
const OUTREACH_COL = columnLetter(TEMPLATE_HEADERS.indexOf('Outreach'))

async function main(): Promise<void> {
  const [spreadsheetId, ...reps] = process.argv.slice(2)
  if (!spreadsheetId || !reps.length) {
    console.error('usage: npx tsx scripts/rebuild-dashboard.ts <spreadsheetId> <repTab> [...]')
    process.exit(1)
  }
  const client = new SheetsClient(new SheetsAuth())

  const sum = (expr: (tab: string) => string) => '=' + reps.map(expr).join('+')
  const stageCount = (stage: string) =>
    sum((t) => `COUNTIF('${t}'!$${STAGE_COL}:$${STAGE_COL},"${stage}")`)
  const total = sum((t) => `COUNTA('${t}'!$A$2:$A)`)
  // Any channel touched at all — the Outreach column is non-empty exactly then.
  const contacted = sum((t) => `COUNTIF('${t}'!$${OUTREACH_COL}$2:$${OUTREACH_COL},"?*")`)
  const pct = (cell: string) => `=IF($A$5>0,TEXT(${cell}/$A$5,"0%"),"—")`

  const rows: string[][] = []
  const put = (r: number, v: string[]) => { rows[r - 1] = v }

  put(1, ['ATLAS LEAD PIPELINE'])
  put(2, ['=TEXT(TODAY(),"dddd, d mmmm yyyy")'])
  put(4, ['LEADS', 'CONTACTED', 'INTERESTED', 'DEMOS', 'TRIALS', 'WON', 'LOST'])
  put(5, [
    total,
    contacted,
    '=' + ['Interested', 'Demo Booked', 'Trial Active', 'Closed-Won']
      .map((s) => stageCount(s).slice(1)).join('+'),
    '=' + ['Demo Booked', 'Trial Active', 'Closed-Won'].map((s) => stageCount(s).slice(1)).join('+'),
    '=' + ['Trial Active', 'Closed-Won'].map((s) => stageCount(s).slice(1)).join('+'),
    stageCount('Closed-Won'),
    '=' + ['Closed-Lost', 'Not Interested', 'DNC'].map((s) => stageCount(s).slice(1)).join('+'),
  ])
  put(6, ['Total in pipeline', '=IF($A$5>0,TEXT(B5/$A$5,"0%"),"0%")&" contact rate"',
    '=IF($A$5>0,TEXT(C5/$A$5,"0%"),"0%")&" interest rate"',
    '=IF($A$5>0,TEXT(D5/$A$5,"0%"),"0%")&" demo rate"',
    '=IF($A$5>0,TEXT(E5/$A$5,"0%"),"0%")&" trial rate"',
    '=IF($A$5>0,TEXT(F5/$A$5,"0%"),"0%")&" win rate"',
    '=IF($A$5>0,TEXT(G5/$A$5,"0%"),"0%")&" lost rate"'])

  put(8, ['STAGE BREAKDOWN'])
  put(9, ['STAGE', 'COUNT', '%'])
  STAGE_VALUES.forEach((s, i) => put(10 + i, [s, stageCount(s), pct(`B${10 + i}`)]))

  const chStart = 10 + STAGE_VALUES.length + 1
  put(chStart, ['CHANNEL PERFORMANCE'])
  put(chStart + 1, ['CHANNEL', 'TOUCHED', 'REPLIED', 'REPLY RATE'])
  CHANNELS.forEach((c, i) => {
    const col = columnLetter(TEMPLATE_HEADERS.indexOf(c.header))
    const r = chStart + 2 + i
    const touched = sum((t) => `COUNTIF('${t}'!$${col}:$${col},"?*")`)
    const replied = sum((t) => `COUNTIF('${t}'!$${col}:$${col},"Replied")`)
    put(r, [c.prefix, touched, replied, `=IF(B${r}>0,TEXT(C${r}/B${r},"0%"),"—")`])
  })

  const repStart = chStart + 2 + CHANNELS.length + 1
  put(repStart, ['REP BREAKDOWN'])
  put(repStart + 1, ['REP', 'LEADS', 'CONTACTED', 'WON'])
  reps.forEach((t, i) => {
    const r = repStart + 2 + i
    put(r, [t, `=COUNTA('${t}'!$A$2:$A)`,
      `=COUNTIF('${t}'!$${OUTREACH_COL}$2:$${OUTREACH_COL},"?*")`,
      `=COUNTIF('${t}'!$${STAGE_COL}:$${STAGE_COL},"Closed-Won")`])
  })

  const height = repStart + 2 + reps.length
  for (let i = 0; i < height; i++) if (!rows[i]) rows[i] = ['']

  const tabs = await client.getTabs(spreadsheetId)
  const existing = tabs.find((t) => t.title === 'Dashboard')
  if (existing) await client.batchUpdate(spreadsheetId, [{ deleteSheet: { sheetId: existing.sheetId } }])
  const res = await client.batchUpdate(spreadsheetId, [{
    addSheet: { properties: { title: 'Dashboard', index: 0, gridProperties: { rowCount: height + 10, columnCount: 8, hideGridlines: true } } },
  }])
  const sheetId = (res.replies[0] as { addSheet: { properties: { sheetId: number } } }).addSheet.properties.sheetId

  await client.updateValues(spreadsheetId, "'Dashboard'!A1", rows)

  const rgb = (hex: string) => ({
    red: parseInt(hex.slice(1, 3), 16) / 255,
    green: parseInt(hex.slice(3, 5), 16) / 255,
    blue: parseInt(hex.slice(5, 7), 16) / 255,
  })
  const band = (row: number, bg: string, fg: string, size: number, bold = true) => ({
    repeatCell: {
      range: { sheetId, startRowIndex: row - 1, endRowIndex: row, startColumnIndex: 0, endColumnIndex: 7 },
      cell: { userEnteredFormat: { backgroundColor: rgb(bg), verticalAlignment: 'MIDDLE',
        textFormat: { foregroundColor: rgb(fg), bold, fontSize: size } } },
      fields: 'userEnteredFormat',
    },
  })
  const KPI = ['#284c8c', '#2d7f8c', '#bf7f0c', '#662da5', '#1472b7', '#1e8c21', '#b22121']
  const style: unknown[] = [
    band(1, '#000000', '#ffffff', 18),
    band(2, '#000000', '#b2bfd8', 10, false),
    ...KPI.map((c, i) => ({
      repeatCell: {
        range: { sheetId, startRowIndex: 3, endRowIndex: 4, startColumnIndex: i, endColumnIndex: i + 1 },
        cell: { userEnteredFormat: { backgroundColor: rgb(c), horizontalAlignment: 'CENTER',
          textFormat: { foregroundColor: rgb('#ffffff'), bold: true, fontSize: 9 } } },
        fields: 'userEnteredFormat',
      },
    })),
    {
      repeatCell: {
        range: { sheetId, startRowIndex: 4, endRowIndex: 5, startColumnIndex: 0, endColumnIndex: 7 },
        cell: { userEnteredFormat: { backgroundColor: rgb('#f7f7f9'), horizontalAlignment: 'CENTER',
          textFormat: { foregroundColor: rgb('#14141e'), bold: true, fontSize: 24 } } },
        fields: 'userEnteredFormat',
      },
    },
    ...[8, chStart, repStart].map((r) => band(r, '#e0eaf9', '#192659', 12)),
    ...[9, chStart + 1, repStart + 1].map((r) => band(r, '#efeff2', '#3f3f4c', 10)),
    { updateDimensionProperties: { range: { sheetId, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, properties: { pixelSize: 200 }, fields: 'pixelSize' } },
  ]
  await client.batchUpdate(spreadsheetId, style)
  console.log(`Dashboard rebuilt for ${reps.join(', ')}`)
}

main().catch((e) => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Run it against the live sheet**

```bash
cd server
npx tsx scripts/rebuild-dashboard.ts 1mWsyumDg3PiLgVNqE2qxALVbAbGgZ1L4gDKlGKtdDjU Faizan Amna
```

- [ ] **Step 3: Verify in the browser**

Open the spreadsheet and confirm:
- `LEADS` shows 150.
- Setting `FB Status = Replied` on one row makes `CONTACTED` become 1 and the FB row of **CHANNEL PERFORMANCE** show `1 touched / 1 replied / 100%`.
- No `#REF!` or `#N/A` anywhere.

- [ ] **Step 4: Document the module**

Add to `CLAUDE.md`, after the `server/src/db/store.ts` bullet:

```markdown
- **Google Sheets export** (`server/src/sheets/`): pushes results into a chosen tab of a
  spreadsheet shared with the service account. Auth is a self-signed JWT (`auth.ts`) — no
  SDK. **`sheetTemplate.ts` is the single source of truth for sheet look and feel** (the
  Sheets analogue of `selectors.ts`): headers, the five outreach channel vocabularies,
  colours, dropdowns, conditional formats. Rules that fall out:
  1. Columns are matched to `Business` fields **by header name, never by position**, so a
     tab's CRM columns survive an export. Reserved CRM headers are resolved *before* Atlas
     fields — `FB Status` must not collide with the `facebook` URL field.
  2. The `Outreach` column holds a whole-column `ARRAYFORMULA`. Writing any non-empty value
     into it breaks the formula for every row, so the exporter always writes `''` there.
  3. Writes use `valueInputOption=RAW`. `USER_ENTERED` makes Sheets parse a leading-`+`
     phone number as a formula. The one exception is installing the `ARRAYFORMULA` itself.
  4. Exports are capped at 50k rows (`MAX_EXPORT_ROWS`) and the cap is checked *before* any
     write — Sheets caps a spreadsheet at 10M cells, and a half-written sheet is worse than
     a refusal. CSV remains the path for larger sets.
```

- [ ] **Step 5: Full verification**

Run:

```bash
cd server && npx tsc --noEmit && npx vitest run
cd ../web && npx tsc -b --noEmit && npm run lint
```

Expected: no type errors, no lint errors, all tests pass.

- [ ] **Step 6: Commit**

```bash
git add server/scripts/rebuild-dashboard.ts CLAUDE.md
git commit -m "feat: rebuild dashboard for five-channel outreach model

Funnel now counts Stage rather than the old conflated Status column, and
contact rate counts any channel touched instead of matching 'Called*',
which described only one of five channels. Adds a channel performance
section reporting touched/replied/reply rate per channel.

Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**Spec coverage**

| Spec requirement | Task |
|---|---|
| Service-account auth, JWT, token cache | 2 |
| Share-with address surfaced in UI | 7 (route), 9 (dialog) |
| List spreadsheets / tabs | 3, 7, 9 |
| Append-new-only write mode | 6 |
| placeId dedup via `mapsUrl` `!19s` | 6 |
| Header-name column mapping | 5 |
| Reserved-header collision avoidance | 4, 5 |
| Auto-build styled tab, new-tab creation | 4, 6, 9 |
| Five channel columns + Stage + Outreach formula | 4 |
| Four outcome-based colour rules | 4 |
| Batched append, `RAW`, 50k cap | 3, 6 |
| Error handling incl. 403/413/503 | 3, 6, 7 |
| CSV path unchanged | 9 |
| PUA glyph fix at source | 1 |
| Credential hygiene | 2 |
| Migration of existing tabs | 10 |
| Dashboard rework | 11 |
| Testing incl. `RUN_SHEETS_SMOKE` | see note below |

**Gap found and closed:** the spec called for a live smoke test gated behind
`RUN_SHEETS_SMOKE=1`. Tasks 9 (step 4), 10 (steps 5-6) and 11 (steps 2-3) perform live
round-trip verification against the real spreadsheet manually, which covers the same ground
at this stage. An automated gated smoke test is deliberately deferred: it would need a
dedicated throwaway spreadsheet to avoid mutating production lead data on every CI run.

**Type consistency checked:** `HeaderMap` fields (`width`, `fields`, `stageIndex`,
`outreachIndex`, `mapsUrlIndex`, `nameIndex`, `addressIndex`) are used identically in Tasks 5
and 6. `ExportResult` is `{ appended, skipped, total }` in Tasks 3, 6, 7, 8, 9.
`columnLetter` is defined in Task 5 and consumed in Tasks 6, 10, 11. `CHANNELS` entries carry
`{ header, prefix, values }` in Tasks 4, 10, 11.

**Known ordering constraint:** Task 10 leaves the Dashboard stale; Task 11 fixes it. Do not
stop between them.
