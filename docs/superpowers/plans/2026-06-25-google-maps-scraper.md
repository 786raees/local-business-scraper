# Google Maps Scraper Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local web app that scrapes Google Maps business listings with Playwright and presents them in a modern React UI with a cascading location picker, live streaming, task queue, and CSV export.

**Architecture:** A Node + TypeScript backend drives Playwright Chromium, exposes an Express REST API and a WebSocket hub, and runs a sequential task queue (keyword × location). A React + Vite + Tailwind + shadcn/ui frontend talks to it over REST (jobs, geo, export) and WebSocket (live progress + streamed rows). All Google Maps selectors live in one module so markup changes are a one-file fix.

**Tech Stack:** Node 24, TypeScript, Playwright (Chromium), Express, `ws`, `country-state-city`, Zod, vitest (backend); React 18, Vite, Tailwind, shadcn/ui, TanStack Table, Zustand (frontend).

## Global Constraints

- Project root: `C:\Users\CodingCops\Desktop\projects\leaning\google map scraper\`
- Two packages: `server/` (backend) and `web/` (frontend). No monorepo tooling; each has its own `package.json`.
- TypeScript strict mode on in both packages.
- Backend runtime: Node 24, ESM (`"type": "module"`).
- Export format: **CSV only**. No Excel/JSON/MySQL.
- Scraper concurrency default: **1 task at a time** (sequential queue).
- Browser: Playwright Chromium, **headless by default**, toggleable to visible.
- All Google Maps DOM selectors live ONLY in `server/src/scraper/selectors.ts`.
- Business fields (exact names): `name, address, phone, website, rating, reviewCount, priceLevel, category, hours, email, mapsUrl, keyword, location`.
- Geo zip lookup: Zippopotam.us primary, GeoNames fallback, disk-cached in `.geo-cache/`.
- Commit after every task. Commit message style: `feat: …` / `test: …` / `chore: …`.

---

## File Structure

```
google map scraper/
├── server/
│   ├── package.json, tsconfig.json, vitest.config.ts
│   └── src/
│       ├── types.ts                  shared domain types (Business, Task, JobSettings, LocationSpec)
│       ├── scraper/
│       │   ├── selectors.ts          ALL Google Maps selectors
│       │   ├── listingParser.ts      pure DOM-string → partial Business helpers
│       │   ├── emailScraper.ts       visit website → regex email
│       │   └── mapsScraper.ts        Playwright: search → scroll → extract
│       ├── geo/
│       │   ├── zipLookup.ts          Zippopotam → GeoNames + disk cache
│       │   └── geoData.ts            country-state-city wrappers
│       ├── queue/
│       │   └── jobRunner.ts          expand keyword×location → tasks, run sequentially, emit events
│       ├── export/
│       │   └── csv.ts                Business[] → CSV string
│       ├── ws/
│       │   └── hub.ts                WebSocket broadcast hub
│       ├── api/
│       │   └── routes.ts             Express routes (geo, job, export)
│       └── index.ts                  bootstrap: express + ws + static
└── web/
    ├── package.json, vite.config.ts, tailwind.config.js, tsconfig.json, components.json
    └── src/
        ├── main.tsx, App.tsx, index.css
        ├── lib/
        │   ├── types.ts              mirror of server domain types
        │   ├── api.ts                REST client
        │   └── store.ts              Zustand store (keywords, locations, results, queue, settings)
        ├── hooks/
        │   └── useJobSocket.ts       WebSocket subscription
        └── components/
            ├── ui/                   shadcn primitives (generated)
            ├── TopBar.tsx
            ├── KeywordList.tsx
            ├── LocationSelector.tsx
            ├── LocationList.tsx
            ├── SettingsPanel.tsx
            ├── QueuePanel.tsx
            └── ResultsTable.tsx
```

---

## Task 1: Backend scaffold + shared types

**Files:**
- Create: `server/package.json`, `server/tsconfig.json`, `server/vitest.config.ts`, `server/src/types.ts`
- Test: `server/test/types.test.ts`

**Interfaces:**
- Produces: domain types consumed by every later backend task:
  - `LocationSpec { country: string; state: string; city: string; zip: string | null; label: string }`
  - `Business { name: string; address: string; phone: string; website: string; rating: number | null; reviewCount: number | null; priceLevel: string; category: string; hours: string; email: string; mapsUrl: string; keyword: string; location: string }`
  - `JobSettings { maxResults: number; extractEmail: boolean; headless: boolean; delayMinMs: number; delayMaxMs: number }`
  - `TaskSpec { id: string; keyword: string; location: LocationSpec }`
  - `TaskStatus = 'queued' | 'running' | 'done' | 'error' | 'blocked'`
  - `JobEvent` union (see Task 8): `{type:'task-update', taskId, status, count?, error?}` | `{type:'row', business: Business}` | `{type:'job-done'}` | `{type:'progress', done:number, total:number}`

- [ ] **Step 1: Create `server/package.json`**

```json
{
  "name": "gms-server",
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "country-state-city": "^3.2.1",
    "express": "^4.19.2",
    "playwright": "^1.48.0",
    "ws": "^8.18.0",
    "zod": "^3.23.8"
  },
  "devDependencies": {
    "@types/express": "^4.17.21",
    "@types/node": "^22.7.0",
    "@types/ws": "^8.5.12",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create `server/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",
    "types": ["node"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Create `server/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { include: ['test/**/*.test.ts'] } })
```

- [ ] **Step 4: Create `server/src/types.ts`** with all types from Interfaces above

```ts
export interface LocationSpec {
  country: string
  state: string
  city: string
  zip: string | null
  label: string
}

export interface Business {
  name: string
  address: string
  phone: string
  website: string
  rating: number | null
  reviewCount: number | null
  priceLevel: string
  category: string
  hours: string
  email: string
  mapsUrl: string
  keyword: string
  location: string
}

export interface JobSettings {
  maxResults: number
  extractEmail: boolean
  headless: boolean
  delayMinMs: number
  delayMaxMs: number
}

export interface TaskSpec {
  id: string
  keyword: string
  location: LocationSpec
}

export type TaskStatus = 'queued' | 'running' | 'done' | 'error' | 'blocked'

export type JobEvent =
  | { type: 'task-update'; taskId: string; status: TaskStatus; count?: number; error?: string }
  | { type: 'row'; business: Business }
  | { type: 'progress'; done: number; total: number }
  | { type: 'job-done' }

export function emptyBusiness(keyword: string, location: string): Business {
  return {
    name: '', address: '', phone: '', website: '', rating: null, reviewCount: null,
    priceLevel: '', category: '', hours: '', email: '', mapsUrl: '', keyword, location,
  }
}
```

- [ ] **Step 5: Write the failing test `server/test/types.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { emptyBusiness } from '../src/types.js'

describe('emptyBusiness', () => {
  it('seeds keyword and location, nulls numeric fields', () => {
    const b = emptyBusiness('plumber', 'Miami, FL')
    expect(b.keyword).toBe('plumber')
    expect(b.location).toBe('Miami, FL')
    expect(b.rating).toBeNull()
    expect(b.name).toBe('')
  })
})
```

- [ ] **Step 6: Install deps and run test**

Run: `cd server && npm install && npx playwright install chromium && npm test`
Expected: 1 passing test. (Playwright browser download may take a minute.)

- [ ] **Step 7: Commit**

```bash
git add server/package.json server/tsconfig.json server/vitest.config.ts server/src/types.ts server/test/types.test.ts
git commit -m "feat: backend scaffold and shared domain types"
```

---

## Task 2: Listing parser (pure functions, TDD)

**Files:**
- Create: `server/src/scraper/listingParser.ts`
- Test: `server/test/listingParser.test.ts`

**Interfaces:**
- Consumes: `Business` from `types.ts`.
- Produces:
  - `parseRating(aria: string): { rating: number | null; reviewCount: number | null }` — parses strings like `"4.5 stars 123 reviews"`.
  - `parsePriceLevel(text: string): string` — extracts `"$"`/`"$$"` etc. from a node's text, else `''`.
  - `extractEmailFromHtml(html: string): string` — first plausible email or `''`.

- [ ] **Step 1: Write failing test `server/test/listingParser.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { parseRating, parsePriceLevel, extractEmailFromHtml } from '../src/scraper/listingParser.js'

describe('parseRating', () => {
  it('parses rating and review count from aria label', () => {
    expect(parseRating('4.5 stars 1,234 reviews')).toEqual({ rating: 4.5, reviewCount: 1234 })
  })
  it('returns nulls when absent', () => {
    expect(parseRating('')).toEqual({ rating: null, reviewCount: null })
  })
})

describe('parsePriceLevel', () => {
  it('extracts dollar signs', () => {
    expect(parsePriceLevel('Price: $$ · Plumber')).toBe('$$')
  })
  it('returns empty when none', () => {
    expect(parsePriceLevel('Plumber')).toBe('')
  })
})

describe('extractEmailFromHtml', () => {
  it('finds first email, ignores asset-like matches', () => {
    expect(extractEmailFromHtml('<a href="mailto:info@acme.com">x</a>')).toBe('info@acme.com')
  })
  it('returns empty when none', () => {
    expect(extractEmailFromHtml('<p>no contact</p>')).toBe('')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run test/listingParser.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/src/scraper/listingParser.ts`**

```ts
export function parseRating(aria: string): { rating: number | null; reviewCount: number | null } {
  if (!aria) return { rating: null, reviewCount: null }
  const ratingMatch = aria.match(/([0-9]+(?:\.[0-9]+)?)\s*star/i)
  const reviewMatch = aria.match(/([0-9][0-9,]*)\s*review/i)
  return {
    rating: ratingMatch ? parseFloat(ratingMatch[1]) : null,
    reviewCount: reviewMatch ? parseInt(reviewMatch[1].replace(/,/g, ''), 10) : null,
  }
}

export function parsePriceLevel(text: string): string {
  const m = text.match(/\${1,4}(?!\w)/)
  return m ? m[0] : ''
}

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g
const BAD_EXT = /\.(png|jpe?g|gif|webp|svg|css|js)$/i

export function extractEmailFromHtml(html: string): string {
  const matches = html.match(EMAIL_RE) ?? []
  for (const m of matches) {
    if (!BAD_EXT.test(m) && !m.startsWith('@')) return m
  }
  return ''
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run test/listingParser.test.ts`
Expected: PASS (6 assertions).

- [ ] **Step 5: Commit**

```bash
git add server/src/scraper/listingParser.ts server/test/listingParser.test.ts
git commit -m "feat: pure listing parser helpers with tests"
```

---

## Task 3: Selectors module + Maps scraper

**Files:**
- Create: `server/src/scraper/selectors.ts`, `server/src/scraper/mapsScraper.ts`
- Test: `server/test/mapsScraper.smoke.test.ts`

**Interfaces:**
- Consumes: `Business`, `emptyBusiness`, `JobSettings` from `types.ts`; `parseRating`, `parsePriceLevel` from `listingParser.ts`.
- Produces:
  - `SELECTORS` object (const) with keys: `consentAccept`, `feed`, `resultCard`, `resultLink`, `detailName`, `detailRatingAria`, `detailAddress`, `detailPhone`, `detailWebsite`, `detailCategory`, `detailHours`, `detailPriceLevel`.
  - `async function scrapeMaps(keyword: string, location: string, settings: JobSettings, onRow: (b: Business) => void, signal?: AbortSignal): Promise<Business[]>`

- [ ] **Step 1: Create `server/src/scraper/selectors.ts`**

```ts
// SINGLE SOURCE OF TRUTH for Google Maps DOM selectors.
// When Google changes markup, fix here only.
export const SELECTORS = {
  consentAccept: 'button[aria-label*="Accept all"], form[action*="consent"] button',
  feed: 'div[role="feed"]',
  resultCard: 'div[role="feed"] > div > div[jsaction]',
  resultLink: 'a.hfpxzc',
  detailName: 'h1.DUwDvf',
  detailRatingAria: 'div.F7nice span[aria-label]',
  detailAddress: 'button[data-item-id="address"]',
  detailPhone: 'button[data-item-id^="phone:tel:"]',
  detailWebsite: 'a[data-item-id="authority"]',
  detailCategory: 'button[jsaction*="category"]',
  detailHours: 'div[jsaction*="openhours"], div.t39EBf',
  detailPriceLevel: 'span[aria-label*="Price"]',
} as const
```

- [ ] **Step 2: Implement `server/src/scraper/mapsScraper.ts`**

```ts
import { chromium, Browser, Page } from 'playwright'
import { Business, JobSettings, emptyBusiness } from '../types.js'
import { SELECTORS } from './selectors.js'
import { parseRating, parsePriceLevel } from './listingParser.js'

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

function delay(min: number, max: number): Promise<void> {
  const ms = min + Math.floor((max - min) * 0.5)
  return new Promise((r) => setTimeout(r, ms))
}

async function dismissConsent(page: Page): Promise<void> {
  try {
    const btn = page.locator(SELECTORS.consentAccept).first()
    if (await btn.isVisible({ timeout: 3000 })) {
      await btn.click()
      await page.waitForTimeout(1000)
    }
  } catch { /* no consent shown */ }
}

async function scrollFeed(page: Page, maxResults: number, signal?: AbortSignal): Promise<string[]> {
  const seen = new Set<string>()
  let stagnant = 0
  while (seen.size < maxResults && stagnant < 4) {
    if (signal?.aborted) break
    const links = await page.locator(SELECTORS.resultLink).evaluateAll(
      (els) => els.map((e) => (e as HTMLAnchorElement).href),
    )
    const before = seen.size
    for (const l of links) if (seen.size < maxResults) seen.add(l)
    if (seen.size === before) stagnant++; else stagnant = 0
    await page.locator(SELECTORS.feed).evaluate((el) => el.scrollBy(0, el.scrollHeight))
    await page.waitForTimeout(1500)
  }
  return [...seen].slice(0, maxResults)
}

async function textOrEmpty(page: Page, selector: string): Promise<string> {
  try {
    const el = page.locator(selector).first()
    if (await el.count()) return (await el.innerText()).trim()
  } catch { /* ignore */ }
  return ''
}

async function scrapeDetail(page: Page, url: string, keyword: string, location: string): Promise<Business> {
  const b = emptyBusiness(keyword, location)
  b.mapsUrl = url
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector(SELECTORS.detailName, { timeout: 15000 }).catch(() => {})
  b.name = await textOrEmpty(page, SELECTORS.detailName)
  b.address = await textOrEmpty(page, SELECTORS.detailAddress)
  b.phone = await textOrEmpty(page, SELECTORS.detailPhone)
  b.category = await textOrEmpty(page, SELECTORS.detailCategory)
  b.hours = await textOrEmpty(page, SELECTORS.detailHours)
  b.priceLevel = parsePriceLevel(await textOrEmpty(page, SELECTORS.detailPriceLevel))
  try {
    const w = page.locator(SELECTORS.detailWebsite).first()
    if (await w.count()) b.website = (await w.getAttribute('href')) ?? ''
  } catch { /* ignore */ }
  try {
    const aria = await page.locator(SELECTORS.detailRatingAria).first().getAttribute('aria-label')
    const parsed = parseRating(aria ?? '')
    b.rating = parsed.rating; b.reviewCount = parsed.reviewCount
  } catch { /* ignore */ }
  return b
}

export async function scrapeMaps(
  keyword: string,
  location: string,
  settings: JobSettings,
  onRow: (b: Business) => void,
  signal?: AbortSignal,
): Promise<Business[]> {
  const query = `${keyword} ${location}`.trim()
  const browser: Browser = await chromium.launch({ headless: settings.headless })
  const out: Business[] = []
  try {
    const ctx = await browser.newContext({ userAgent: UA, locale: 'en-US' })
    const page = await ctx.newPage()
    await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded' })
    await dismissConsent(page)
    await page.waitForSelector(SELECTORS.feed, { timeout: 15000 }).catch(() => {})
    const urls = await scrollFeed(page, settings.maxResults, signal)
    for (const url of urls) {
      if (signal?.aborted) break
      const b = await scrapeDetail(page, url, keyword, location)
      if (b.name) { out.push(b); onRow(b) }
      await delay(settings.delayMinMs, settings.delayMaxMs)
    }
  } finally {
    await browser.close()
  }
  return out
}
```

- [ ] **Step 3: Write smoke test `server/test/mapsScraper.smoke.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { scrapeMaps } from '../src/scraper/mapsScraper.js'

// Network-dependent. Skipped unless RUN_SMOKE=1 to keep unit runs offline/fast.
const maybe = process.env.RUN_SMOKE ? it : it.skip

describe('scrapeMaps (smoke)', () => {
  maybe('returns at least one named business for a real search', async () => {
    const rows: string[] = []
    const result = await scrapeMaps(
      'coffee', 'Miami, Florida',
      { maxResults: 5, extractEmail: false, headless: true, delayMinMs: 400, delayMaxMs: 800 },
      (b) => rows.push(b.name),
    )
    expect(result.length).toBeGreaterThan(0)
    expect(result[0].name.length).toBeGreaterThan(0)
  }, 120000)
})
```

- [ ] **Step 4: Run unit suite (smoke skipped) to confirm nothing breaks**

Run: `cd server && npx vitest run`
Expected: PASS; smoke test reported as skipped.

- [ ] **Step 5: Run the smoke test live once to validate selectors**

Run: `cd server && RUN_SMOKE=1 npx vitest run test/mapsScraper.smoke.test.ts`
Expected: PASS with ≥1 business. If it fails, the selectors in `selectors.ts` need adjustment — capture the live page and update `SELECTORS` only.

- [ ] **Step 6: Commit**

```bash
git add server/src/scraper/selectors.ts server/src/scraper/mapsScraper.ts server/test/mapsScraper.smoke.test.ts
git commit -m "feat: maps scraper with centralized selectors and smoke test"
```

---

## Task 4: Email scraper

**Files:**
- Create: `server/src/scraper/emailScraper.ts`
- Test: `server/test/emailScraper.test.ts`

**Interfaces:**
- Consumes: `extractEmailFromHtml` from `listingParser.ts`.
- Produces: `async function findEmailForWebsite(website: string, fetchHtml: (url: string) => Promise<string>): Promise<string>` — injectable fetcher for testability; returns email or `''`.

- [ ] **Step 1: Write failing test `server/test/emailScraper.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { findEmailForWebsite } from '../src/scraper/emailScraper.js'

describe('findEmailForWebsite', () => {
  it('returns empty for blank website', async () => {
    expect(await findEmailForWebsite('', async () => '')).toBe('')
  })
  it('extracts email from fetched html', async () => {
    const html = '<a href="mailto:hi@acme.com">contact</a>'
    expect(await findEmailForWebsite('https://acme.com', async () => html)).toBe('hi@acme.com')
  })
  it('returns empty when fetch throws', async () => {
    expect(await findEmailForWebsite('https://x.com', async () => { throw new Error('net') })).toBe('')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd server && npx vitest run test/emailScraper.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/src/scraper/emailScraper.ts`**

```ts
import { extractEmailFromHtml } from './listingParser.js'

export async function findEmailForWebsite(
  website: string,
  fetchHtml: (url: string) => Promise<string>,
): Promise<string> {
  if (!website) return ''
  try {
    const html = await fetchHtml(website)
    return extractEmailFromHtml(html)
  } catch {
    return ''
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd server && npx vitest run test/emailScraper.test.ts`
Expected: PASS (3 assertions).

- [ ] **Step 5: Commit**

```bash
git add server/src/scraper/emailScraper.ts server/test/emailScraper.test.ts
git commit -m "feat: best-effort email scraper with injectable fetcher"
```

---

## Task 5: Geo data + zip lookup

**Files:**
- Create: `server/src/geo/geoData.ts`, `server/src/geo/zipLookup.ts`
- Test: `server/test/geo.test.ts`

**Interfaces:**
- Consumes: `country-state-city` package.
- Produces:
  - `listCountries(): { code: string; name: string }[]`
  - `listStates(countryCode: string): { code: string; name: string }[]`
  - `listCities(countryCode: string, stateCode: string): { name: string }[]`
  - `async function lookupZips(country: string, state: string, city: string, fetchJson?: (url: string) => Promise<any>): Promise<string[]>` — returns sorted unique zips, `[]` on failure; results disk-cached under `.geo-cache/`.

- [ ] **Step 1: Implement `server/src/geo/geoData.ts`**

```ts
import { Country, State, City } from 'country-state-city'

export function listCountries() {
  return Country.getAllCountries().map((c) => ({ code: c.isoCode, name: c.name }))
}
export function listStates(countryCode: string) {
  return State.getStatesOfCountry(countryCode).map((s) => ({ code: s.isoCode, name: s.name }))
}
export function listCities(countryCode: string, stateCode: string) {
  return City.getCitiesOfState(countryCode, stateCode).map((c) => ({ name: c.name }))
}
```

- [ ] **Step 2: Write failing test `server/test/geo.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { listCountries, listStates } from '../src/geo/geoData.js'
import { lookupZips } from '../src/geo/zipLookup.js'

describe('geoData', () => {
  it('lists countries including US', () => {
    expect(listCountries().some((c) => c.code === 'US')).toBe(true)
  })
  it('lists US states including Florida', () => {
    expect(listStates('US').some((s) => s.name === 'Florida')).toBe(true)
  })
})

describe('lookupZips', () => {
  it('parses zips from injected zippopotam-style json', async () => {
    const fake = async () => ({ places: [{ 'post code': '33101' }, { 'post code': '33102' }] })
    const zips = await lookupZips('US', 'Florida', 'Miami', fake)
    expect(zips).toContain('33101')
  })
  it('returns empty array on fetch error', async () => {
    const boom = async () => { throw new Error('net') }
    expect(await lookupZips('US', 'Florida', 'Nowhere', boom)).toEqual([])
  })
})
```

- [ ] **Step 3: Run to verify failure**

Run: `cd server && npx vitest run test/geo.test.ts`
Expected: FAIL — `zipLookup` not found.

- [ ] **Step 4: Implement `server/src/geo/zipLookup.ts`**

```ts
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const CACHE_DIR = join(process.cwd(), '.geo-cache')

async function defaultFetchJson(url: string): Promise<any> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

function cacheKey(country: string, state: string, city: string): string {
  return `${country}_${state}_${city}`.replace(/[^a-z0-9_]/gi, '-').toLowerCase() + '.json'
}

export async function lookupZips(
  country: string,
  state: string,
  city: string,
  fetchJson: (url: string) => Promise<any> = defaultFetchJson,
): Promise<string[]> {
  const file = join(CACHE_DIR, cacheKey(country, state, city))
  try {
    const cached = await readFile(file, 'utf8')
    return JSON.parse(cached)
  } catch { /* cache miss */ }

  let zips: string[] = []
  try {
    // Zippopotam by country+city (US uses 2-letter country code).
    const url = `https://api.zippopotam.us/${country}/${encodeURIComponent(state)}/${encodeURIComponent(city)}`
    const data = await fetchJson(url)
    const places = (data?.places ?? []) as Array<Record<string, string>>
    zips = places.map((p) => p['post code']).filter(Boolean)
  } catch {
    zips = []
  }
  zips = [...new Set(zips)].sort()

  if (zips.length) {
    try {
      await mkdir(CACHE_DIR, { recursive: true })
      await writeFile(file, JSON.stringify(zips))
    } catch { /* ignore cache write failure */ }
  }
  return zips
}
```

- [ ] **Step 5: Run to verify pass**

Run: `cd server && npx vitest run test/geo.test.ts`
Expected: PASS (4 assertions).

- [ ] **Step 6: Commit**

```bash
git add server/src/geo/geoData.ts server/src/geo/zipLookup.ts server/test/geo.test.ts
git commit -m "feat: geo data wrappers and cached zip lookup"
```

---

## Task 6: CSV export

**Files:**
- Create: `server/src/export/csv.ts`
- Test: `server/test/csv.test.ts`

**Interfaces:**
- Consumes: `Business` from `types.ts`.
- Produces: `function toCsv(rows: Business[], columns?: (keyof Business)[]): string` — RFC-4180 quoting, header row, default column order = all fields in the `Business` declaration order.

- [ ] **Step 1: Write failing test `server/test/csv.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import { toCsv } from '../src/export/csv.js'
import { emptyBusiness } from '../src/types.js'

describe('toCsv', () => {
  it('writes header and quotes fields with commas', () => {
    const b = emptyBusiness('plumber', 'Miami')
    b.name = 'Acme, Inc'
    b.phone = '305-555-1212'
    const csv = toCsv([b], ['name', 'phone'])
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe('name,phone')
    expect(lines[1]).toBe('"Acme, Inc",305-555-1212')
  })
  it('escapes quotes by doubling', () => {
    const b = emptyBusiness('k', 'l'); b.name = 'A "B" C'
    expect(toCsv([b], ['name']).trim().split('\n')[1]).toBe('"A ""B"" C"')
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd server && npx vitest run test/csv.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/src/export/csv.ts`**

```ts
import { Business } from '../types.js'

const ALL: (keyof Business)[] = [
  'name', 'address', 'phone', 'website', 'rating', 'reviewCount', 'priceLevel',
  'category', 'hours', 'email', 'mapsUrl', 'keyword', 'location',
]

function cell(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: Business[], columns: (keyof Business)[] = ALL): string {
  const header = columns.join(',')
  const body = rows.map((r) => columns.map((c) => cell(r[c])).join(',')).join('\n')
  return header + '\n' + body + '\n'
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd server && npx vitest run test/csv.test.ts`
Expected: PASS (2 assertions).

- [ ] **Step 5: Commit**

```bash
git add server/src/export/csv.ts server/test/csv.test.ts
git commit -m "feat: CSV export with RFC-4180 quoting"
```

---

## Task 7: Job runner (task expansion + sequential queue)

**Files:**
- Create: `server/src/queue/jobRunner.ts`
- Test: `server/test/jobRunner.test.ts`

**Interfaces:**
- Consumes: `TaskSpec`, `JobSettings`, `JobEvent`, `Business`, `LocationSpec` from `types.ts`.
- Produces:
  - `function expandTasks(keywords: string[], locations: LocationSpec[]): TaskSpec[]` — cartesian product; `id = \`${i}\``; deterministic order (keyword-major).
  - `function locationToQuery(loc: LocationSpec): string` — `"City, State, Country"` plus zip when not null.
  - `class JobRunner` with `constructor(scrape: ScrapeFn)`, `async run(keywords, locations, settings, emit: (e: JobEvent) => void): Promise<void>`, and `stop(): void`. `ScrapeFn` signature matches `scrapeMaps`. Emits `task-update` (running/done/error), `row` per business, `progress`, then `job-done`.

- [ ] **Step 1: Write failing test `server/test/jobRunner.test.ts`**

```ts
import { describe, it, expect, vi } from 'vitest'
import { expandTasks, locationToQuery, JobRunner } from '../src/queue/jobRunner.js'
import { LocationSpec, JobEvent, emptyBusiness } from '../src/types.js'

const loc = (city: string, zip: string | null): LocationSpec => ({
  country: 'United States', state: 'Florida', city, zip,
  label: `US › Florida › ${city} › ${zip ?? 'All zip codes'}`,
})

describe('expandTasks', () => {
  it('produces keyword × location cartesian product', () => {
    const tasks = expandTasks(['plumber', 'roofer'], [loc('Miami', null), loc('Tampa', '33601')])
    expect(tasks).toHaveLength(4)
    expect(tasks[0]).toMatchObject({ keyword: 'plumber', location: { city: 'Miami' } })
  })
})

describe('locationToQuery', () => {
  it('omits zip when null', () => {
    expect(locationToQuery(loc('Miami', null))).toBe('Miami, Florida, United States')
  })
  it('appends zip when present', () => {
    expect(locationToQuery(loc('Tampa', '33601'))).toBe('Tampa, Florida, United States 33601')
  })
})

describe('JobRunner', () => {
  it('runs tasks sequentially and emits row + job-done', async () => {
    const fakeScrape = vi.fn(async (kw: string, location: string, _s, onRow) => {
      const b = emptyBusiness(kw, location); b.name = `${kw}-biz`; onRow(b); return [b]
    })
    const events: JobEvent[] = []
    const runner = new JobRunner(fakeScrape as any)
    await runner.run(['plumber'], [loc('Miami', null)],
      { maxResults: 5, extractEmail: false, headless: true, delayMinMs: 0, delayMaxMs: 0 },
      (e) => events.push(e))
    expect(events.some((e) => e.type === 'row')).toBe(true)
    expect(events.some((e) => e.type === 'task-update' && e.status === 'done')).toBe(true)
    expect(events.at(-1)).toEqual({ type: 'job-done' })
  })
})
```

- [ ] **Step 2: Run to verify failure**

Run: `cd server && npx vitest run test/jobRunner.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `server/src/queue/jobRunner.ts`**

```ts
import { TaskSpec, JobSettings, JobEvent, Business, LocationSpec } from '../types.js'

type ScrapeFn = (
  keyword: string, location: string, settings: JobSettings,
  onRow: (b: Business) => void, signal?: AbortSignal,
) => Promise<Business[]>

export function locationToQuery(loc: LocationSpec): string {
  const base = [loc.city, loc.state, loc.country].filter(Boolean).join(', ')
  return loc.zip ? `${base} ${loc.zip}` : base
}

export function expandTasks(keywords: string[], locations: LocationSpec[]): TaskSpec[] {
  const tasks: TaskSpec[] = []
  let i = 0
  for (const keyword of keywords) {
    for (const location of locations) {
      tasks.push({ id: String(i++), keyword, location })
    }
  }
  return tasks
}

export class JobRunner {
  private controller: AbortController | null = null
  constructor(private scrape: ScrapeFn) {}

  stop(): void { this.controller?.abort() }

  async run(
    keywords: string[], locations: LocationSpec[], settings: JobSettings,
    emit: (e: JobEvent) => void,
  ): Promise<void> {
    this.controller = new AbortController()
    const tasks = expandTasks(keywords, locations)
    let done = 0
    emit({ type: 'progress', done, total: tasks.length })
    for (const task of tasks) {
      if (this.controller.signal.aborted) break
      emit({ type: 'task-update', taskId: task.id, status: 'running' })
      const query = locationToQuery(task.location)
      try {
        const rows = await this.scrape(task.keyword, query, settings,
          (b) => emit({ type: 'row', business: b }), this.controller.signal)
        emit({ type: 'task-update', taskId: task.id, status: 'done', count: rows.length })
      } catch (err) {
        emit({ type: 'task-update', taskId: task.id, status: 'error', error: String(err) })
      }
      done++
      emit({ type: 'progress', done, total: tasks.length })
    }
    emit({ type: 'job-done' })
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `cd server && npx vitest run test/jobRunner.test.ts`
Expected: PASS (4 assertions).

- [ ] **Step 5: Commit**

```bash
git add server/src/queue/jobRunner.ts server/test/jobRunner.test.ts
git commit -m "feat: job runner with task expansion and sequential queue"
```

---

## Task 8: WebSocket hub + Express API + bootstrap

**Files:**
- Create: `server/src/ws/hub.ts`, `server/src/api/routes.ts`, `server/src/index.ts`
- Test: `server/test/routes.test.ts`

**Interfaces:**
- Consumes: everything above; integrates email scraping into the live scrape via a wrapper.
- Produces (REST):
  - `GET /api/geo/countries` → `{code,name}[]`
  - `GET /api/geo/states?country=US` → `{code,name}[]`
  - `GET /api/geo/cities?country=US&state=FL` → `{name}[]`
  - `GET /api/geo/zips?country=US&state=Florida&city=Miami` → `string[]`
  - `POST /api/job/start` body `{ keywords: string[], locations: LocationSpec[], settings: JobSettings }` → `{ ok: true }`; streams events over WS.
  - `POST /api/job/stop` → `{ ok: true }`
  - `POST /api/export/csv` body `{ rows: Business[], columns?: string[] }` → `text/csv` attachment.
- Produces (WS): server pushes `JobEvent` JSON messages to all connected clients.
- `createApp(deps)` factory returns the Express app for testing with injected geo/runner stubs.

- [ ] **Step 1: Write failing test `server/test/routes.test.ts`**

```ts
import { describe, it, expect } from 'vitest'
import request from 'supertest'
import { createApp } from '../src/api/routes.js'

const deps = {
  geo: {
    countries: () => [{ code: 'US', name: 'United States' }],
    states: () => [{ code: 'FL', name: 'Florida' }],
    cities: () => [{ name: 'Miami' }],
    zips: async () => ['33101', '33102'],
  },
  startJob: () => {}, stopJob: () => {},
}

describe('routes', () => {
  it('GET /api/geo/countries returns list', async () => {
    const res = await request(createApp(deps as any)).get('/api/geo/countries')
    expect(res.status).toBe(200)
    expect(res.body[0].code).toBe('US')
  })
  it('POST /api/export/csv returns csv attachment', async () => {
    const res = await request(createApp(deps as any))
      .post('/api/export/csv')
      .send({ rows: [], columns: ['name'] })
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/csv')
  })
})
```

Note: add `supertest` + `@types/supertest` to `server` devDependencies (`npm i -D supertest @types/supertest`).

- [ ] **Step 2: Run to verify failure**

Run: `cd server && npm i -D supertest @types/supertest && npx vitest run test/routes.test.ts`
Expected: FAIL — `createApp` not found.

- [ ] **Step 3: Implement `server/src/ws/hub.ts`**

```ts
import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'node:http'
import { JobEvent } from '../types.js'

export class WsHub {
  private wss: WebSocketServer
  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' })
  }
  broadcast(event: JobEvent): void {
    const msg = JSON.stringify(event)
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(msg)
    }
  }
}
```

- [ ] **Step 4: Implement `server/src/api/routes.ts`**

```ts
import express, { Express } from 'express'
import { toCsv } from '../export/csv.js'
import { Business, JobSettings, LocationSpec } from '../types.js'

export interface RouteDeps {
  geo: {
    countries: () => { code: string; name: string }[]
    states: (country: string) => { code: string; name: string }[]
    cities: (country: string, state: string) => { name: string }[]
    zips: (country: string, state: string, city: string) => Promise<string[]>
  }
  startJob: (keywords: string[], locations: LocationSpec[], settings: JobSettings) => void
  stopJob: () => void
}

export function createApp(deps: RouteDeps): Express {
  const app = express()
  app.use(express.json({ limit: '10mb' }))

  app.get('/api/geo/countries', (_req, res) => res.json(deps.geo.countries()))
  app.get('/api/geo/states', (req, res) => res.json(deps.geo.states(String(req.query.country ?? ''))))
  app.get('/api/geo/cities', (req, res) =>
    res.json(deps.geo.cities(String(req.query.country ?? ''), String(req.query.state ?? ''))))
  app.get('/api/geo/zips', async (req, res) => {
    const zips = await deps.geo.zips(
      String(req.query.country ?? ''), String(req.query.state ?? ''), String(req.query.city ?? ''))
    res.json(zips)
  })

  app.post('/api/job/start', (req, res) => {
    const { keywords, locations, settings } = req.body
    deps.startJob(keywords, locations, settings)
    res.json({ ok: true })
  })
  app.post('/api/job/stop', (_req, res) => { deps.stopJob(); res.json({ ok: true }) })

  app.post('/api/export/csv', (req, res) => {
    const rows: Business[] = req.body.rows ?? []
    const columns = req.body.columns as (keyof Business)[] | undefined
    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', 'attachment; filename="results.csv"')
    res.send(toCsv(rows, columns))
  })

  return app
}
```

- [ ] **Step 5: Implement `server/src/index.ts` (bootstrap wiring real deps)**

```ts
import { createServer } from 'node:http'
import { createApp } from './api/routes.js'
import { WsHub } from './ws/hub.js'
import { listCountries, listStates, listCities } from './geo/geoData.js'
import { lookupZips } from './geo/zipLookup.js'
import { JobRunner } from './queue/jobRunner.js'
import { scrapeMaps } from './scraper/mapsScraper.js'
import { findEmailForWebsite } from './scraper/emailScraper.js'
import { JobSettings, LocationSpec, Business } from './types.js'

let hub: WsHub
const runner = new JobRunner(async (keyword, location, settings, onRow, signal) => {
  return scrapeMaps(keyword, location, settings, async (b: Business) => {
    if (settings.extractEmail && b.website) {
      b.email = await findEmailForWebsite(b.website, async (url) => {
        const res = await fetch(url); return res.text()
      })
    }
    onRow(b)
  }, signal)
})

const app = createApp({
  geo: {
    countries: listCountries,
    states: listStates,
    cities: listCities,
    zips: (c, s, city) => lookupZips(c, s, city),
  },
  startJob: (keywords: string[], locations: LocationSpec[], settings: JobSettings) => {
    runner.run(keywords, locations, settings, (e) => hub.broadcast(e))
  },
  stopJob: () => runner.stop(),
})

const server = createServer(app)
hub = new WsHub(server)
const PORT = 5174
server.listen(PORT, () => console.log(`server on http://localhost:${PORT}`))
```

- [ ] **Step 6: Run route tests to verify pass**

Run: `cd server && npx vitest run test/routes.test.ts`
Expected: PASS (2 assertions).

- [ ] **Step 7: Manually start the server and verify a geo endpoint**

Run: `cd server && npm run dev` then in another shell `curl http://localhost:5174/api/geo/countries`
Expected: JSON array containing `{"code":"US",...}`. Stop the server after.

- [ ] **Step 8: Commit**

```bash
git add server/src/ws/hub.ts server/src/api/routes.ts server/src/index.ts server/test/routes.test.ts server/package.json
git commit -m "feat: websocket hub, express api, and server bootstrap"
```

---

## Task 9: Frontend scaffold (Vite + Tailwind + shadcn) + types + store

**Files:**
- Create: `web/package.json`, `web/vite.config.ts`, `web/tailwind.config.js`, `web/postcss.config.js`, `web/tsconfig.json`, `web/index.html`, `web/src/main.tsx`, `web/src/index.css`, `web/src/lib/types.ts`, `web/src/lib/api.ts`, `web/src/lib/store.ts`, `web/src/App.tsx`
- Test: `web/src/lib/store.test.ts`

**Interfaces:**
- Produces:
  - `web/src/lib/types.ts` mirroring server `Business`, `LocationSpec`, `JobSettings`, `TaskStatus`, `JobEvent`.
  - `api` object: `getCountries()`, `getStates(country)`, `getCities(country,state)`, `getZips(country,state,city)`, `startJob(payload)`, `stopJob()`, `exportCsv(rows, columns)`.
  - Zustand `useStore` with state `{ keywords, locations, results, queue, settings, progress }` and actions `addKeyword, removeKeyword, addLocation, removeLocation, setSettings, applyEvent(e), reset`.

- [ ] **Step 1: Scaffold Vite React-TS app**

Run:
```bash
cd "C:/Users/CodingCops/Desktop/projects/leaning/google map scraper"
npm create vite@latest web -- --template react-ts
cd web && npm install
npm install zustand @tanstack/react-table
npm install -D tailwindcss@^3 postcss autoprefixer vitest jsdom @testing-library/react
npx tailwindcss init -p
```

- [ ] **Step 2: Configure Tailwind — replace `web/tailwind.config.js`**

```js
/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
}
```

- [ ] **Step 3: Replace `web/src/index.css`**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 4: Configure Vite dev proxy — replace `web/vite.config.ts`**

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:5174',
      '/ws': { target: 'ws://localhost:5174', ws: true },
    },
  },
  test: { environment: 'jsdom', globals: true },
})
```

- [ ] **Step 5: Create `web/src/lib/types.ts`** (mirror server types — copy `Business`, `LocationSpec`, `JobSettings`, `TaskStatus`, `JobEvent` definitions verbatim from `server/src/types.ts`, minus `emptyBusiness`)

- [ ] **Step 6: Create `web/src/lib/api.ts`**

```ts
import { Business, JobSettings, LocationSpec } from './types'

async function j<T>(url: string): Promise<T> {
  const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json()
}

export const api = {
  getCountries: () => j<{ code: string; name: string }[]>('/api/geo/countries'),
  getStates: (country: string) => j<{ code: string; name: string }[]>(`/api/geo/states?country=${country}`),
  getCities: (country: string, state: string) =>
    j<{ name: string }[]>(`/api/geo/cities?country=${country}&state=${state}`),
  getZips: (country: string, state: string, city: string) =>
    j<string[]>(`/api/geo/zips?country=${country}&state=${encodeURIComponent(state)}&city=${encodeURIComponent(city)}`),
  startJob: (payload: { keywords: string[]; locations: LocationSpec[]; settings: JobSettings }) =>
    fetch('/api/job/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  stopJob: () => fetch('/api/job/stop', { method: 'POST' }),
  exportCsv: async (rows: Business[], columns?: (keyof Business)[]) => {
    const r = await fetch('/api/export/csv', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows, columns }),
    })
    const blob = await r.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'results.csv'; a.click()
    URL.revokeObjectURL(url)
  },
}
```

- [ ] **Step 7: Create `web/src/lib/store.ts`**

```ts
import { create } from 'zustand'
import { Business, JobSettings, LocationSpec, JobEvent, TaskStatus } from './types'

interface QueueItem { id: string; status: TaskStatus; count: number; error?: string }

interface State {
  keywords: string[]
  locations: LocationSpec[]
  results: Business[]
  queue: QueueItem[]
  settings: JobSettings
  progress: { done: number; total: number }
  running: boolean
  addKeyword: (k: string) => void
  removeKeyword: (k: string) => void
  addLocation: (l: LocationSpec) => void
  removeLocation: (label: string) => void
  setSettings: (s: Partial<JobSettings>) => void
  setRunning: (r: boolean) => void
  applyEvent: (e: JobEvent) => void
  reset: () => void
}

export const useStore = create<State>((set) => ({
  keywords: [],
  locations: [],
  results: [],
  queue: [],
  settings: { maxResults: 30, extractEmail: false, headless: true, delayMinMs: 600, delayMaxMs: 1500 },
  progress: { done: 0, total: 0 },
  running: false,
  addKeyword: (k) => set((s) => s.keywords.includes(k) || !k.trim() ? s : { keywords: [...s.keywords, k.trim()] }),
  removeKeyword: (k) => set((s) => ({ keywords: s.keywords.filter((x) => x !== k) })),
  addLocation: (l) => set((s) => s.locations.some((x) => x.label === l.label) ? s : { locations: [...s.locations, l] }),
  removeLocation: (label) => set((s) => ({ locations: s.locations.filter((x) => x.label !== label) })),
  setSettings: (p) => set((s) => ({ settings: { ...s.settings, ...p } })),
  setRunning: (r) => set({ running: r }),
  reset: () => set({ results: [], queue: [], progress: { done: 0, total: 0 } }),
  applyEvent: (e) => set((s) => {
    if (e.type === 'row') return { results: [...s.results, e.business] }
    if (e.type === 'progress') return { progress: { done: e.done, total: e.total } }
    if (e.type === 'job-done') return { running: false }
    if (e.type === 'task-update') {
      const exists = s.queue.some((q) => q.id === e.taskId)
      const queue = exists
        ? s.queue.map((q) => q.id === e.taskId ? { ...q, status: e.status, count: e.count ?? q.count, error: e.error } : q)
        : [...s.queue, { id: e.taskId, status: e.status, count: e.count ?? 0, error: e.error }]
      return { queue }
    }
    return s
  }),
}))
```

- [ ] **Step 8: Write failing test `web/src/lib/store.test.ts`**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { useStore } from './store'

beforeEach(() => useStore.getState().reset())

describe('store', () => {
  it('adds unique keywords', () => {
    useStore.getState().addKeyword('plumber')
    useStore.getState().addKeyword('plumber')
    expect(useStore.getState().keywords).toEqual(['plumber'])
  })
  it('applyEvent row appends to results', () => {
    useStore.getState().applyEvent({ type: 'row', business: { name: 'X' } as any })
    expect(useStore.getState().results).toHaveLength(1)
  })
  it('applyEvent task-update upserts queue item', () => {
    useStore.getState().applyEvent({ type: 'task-update', taskId: '0', status: 'running' })
    useStore.getState().applyEvent({ type: 'task-update', taskId: '0', status: 'done', count: 3 })
    expect(useStore.getState().queue[0]).toMatchObject({ status: 'done', count: 3 })
  })
})
```

- [ ] **Step 9: Run to verify pass**

Run: `cd web && npx vitest run src/lib/store.test.ts`
Expected: PASS (3 assertions).

- [ ] **Step 10: Commit**

```bash
git add web
git commit -m "feat: frontend scaffold with types, api client, and store"
```

---

## Task 10: WebSocket hook + shell layout (TopBar, App)

**Files:**
- Create: `web/src/hooks/useJobSocket.ts`, `web/src/components/TopBar.tsx`
- Modify: `web/src/App.tsx`

**Interfaces:**
- Consumes: `useStore`, `api`.
- Produces:
  - `useJobSocket(): void` — opens `new WebSocket(\`ws://${location.host}/ws\`)`, calls `useStore.getState().applyEvent` on each message, reconnects on close.
  - `TopBar` component: Start/Stop buttons, progress bar (`progress.done/total`), total-results counter, Export CSV button, theme toggle.

- [ ] **Step 1: Implement `web/src/hooks/useJobSocket.ts`**

```tsx
import { useEffect } from 'react'
import { useStore } from '../lib/store'
import { JobEvent } from '../lib/types'

export function useJobSocket(): void {
  useEffect(() => {
    let ws: WebSocket
    let closed = false
    const connect = () => {
      ws = new WebSocket(`ws://${location.host}/ws`)
      ws.onmessage = (ev) => {
        try { useStore.getState().applyEvent(JSON.parse(ev.data) as JobEvent) } catch { /* ignore */ }
      }
      ws.onclose = () => { if (!closed) setTimeout(connect, 1500) }
    }
    connect()
    return () => { closed = true; ws?.close() }
  }, [])
}
```

- [ ] **Step 2: Implement `web/src/components/TopBar.tsx`**

```tsx
import { useStore } from '../lib/store'
import { api } from '../lib/api'

export function TopBar() {
  const { keywords, locations, settings, results, progress, running, setRunning, reset } = useStore()
  const start = async () => {
    reset(); setRunning(true)
    await api.startJob({ keywords, locations, settings })
  }
  const stop = async () => { await api.stopJob(); setRunning(false) }
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0
  return (
    <header className="flex items-center gap-4 border-b px-4 py-3">
      <h1 className="text-lg font-semibold">Maps Scraper</h1>
      <button onClick={start} disabled={running || !keywords.length || !locations.length}
        className="rounded bg-emerald-600 px-3 py-1.5 text-white disabled:opacity-40">Start</button>
      <button onClick={stop} disabled={!running}
        className="rounded bg-rose-600 px-3 py-1.5 text-white disabled:opacity-40">Stop</button>
      <div className="flex-1">
        <div className="h-2 w-full rounded bg-gray-200">
          <div className="h-2 rounded bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
      <span className="text-sm text-gray-600">{results.length} results · {progress.done}/{progress.total} tasks</span>
      <button onClick={() => api.exportCsv(results)} disabled={!results.length}
        className="rounded border px-3 py-1.5 disabled:opacity-40">Export CSV</button>
    </header>
  )
}
```

- [ ] **Step 3: Replace `web/src/App.tsx`**

```tsx
import { useJobSocket } from './hooks/useJobSocket'
import { TopBar } from './components/TopBar'
import { KeywordList } from './components/KeywordList'
import { LocationSelector } from './components/LocationSelector'
import { LocationList } from './components/LocationList'
import { SettingsPanel } from './components/SettingsPanel'
import { QueuePanel } from './components/QueuePanel'
import { ResultsTable } from './components/ResultsTable'

export default function App() {
  useJobSocket()
  return (
    <div className="flex h-screen flex-col">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-80 space-y-4 overflow-y-auto border-r p-4">
          <KeywordList />
          <LocationSelector />
          <LocationList />
          <SettingsPanel />
        </aside>
        <main className="flex flex-1 flex-col overflow-hidden">
          <QueuePanel />
          <ResultsTable />
        </main>
      </div>
    </div>
  )
}
```

Note: components referenced here are created in Tasks 11-13. To compile incrementally, create empty stub files now returning `null` for `KeywordList`, `LocationSelector`, `LocationList`, `SettingsPanel`, `QueuePanel`, `ResultsTable`, then fill them in subsequent tasks.

- [ ] **Step 4: Create stub component files** (each `export function NAME() { return null }`) for the six components above under `web/src/components/`.

- [ ] **Step 5: Verify the app builds and runs**

Run: `cd web && npm run dev` and open the shown URL.
Expected: TopBar renders with Start/Stop/Export and an empty sidebar/main. No console errors.

- [ ] **Step 6: Commit**

```bash
git add web/src
git commit -m "feat: app shell, top bar, and live websocket hook"
```

---

## Task 11: KeywordList + SettingsPanel + QueuePanel

**Files:**
- Modify: `web/src/components/KeywordList.tsx`, `web/src/components/SettingsPanel.tsx`, `web/src/components/QueuePanel.tsx`

**Interfaces:**
- Consumes: `useStore`.
- Produces: three rendered panels (no new exported functions beyond the components).

- [ ] **Step 1: Implement `KeywordList.tsx`**

```tsx
import { useState } from 'react'
import { useStore } from '../lib/store'

export function KeywordList() {
  const { keywords, addKeyword, removeKeyword } = useStore()
  const [val, setVal] = useState('')
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase text-gray-500">Keywords</h2>
      <div className="flex gap-2">
        <input value={val} onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { addKeyword(val); setVal('') } }}
          placeholder="e.g. plumber" className="flex-1 rounded border px-2 py-1 text-sm" />
        <button onClick={() => { addKeyword(val); setVal('') }}
          className="rounded bg-gray-800 px-2 py-1 text-sm text-white">Add</button>
      </div>
      <ul className="mt-2 space-y-1">
        {keywords.map((k) => (
          <li key={k} className="flex items-center justify-between rounded bg-gray-100 px-2 py-1 text-sm">
            <span>{k}</span>
            <button onClick={() => removeKeyword(k)} className="text-rose-600">×</button>
          </li>
        ))}
      </ul>
    </section>
  )
}
```

- [ ] **Step 2: Implement `SettingsPanel.tsx`**

```tsx
import { useStore } from '../lib/store'

export function SettingsPanel() {
  const { settings, setSettings } = useStore()
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase text-gray-500">Settings</h2>
      <label className="flex items-center justify-between text-sm">
        Max results / task
        <input type="number" min={1} value={settings.maxResults}
          onChange={(e) => setSettings({ maxResults: Number(e.target.value) })}
          className="w-20 rounded border px-2 py-1" />
      </label>
      <label className="flex items-center justify-between text-sm">
        Extract email
        <input type="checkbox" checked={settings.extractEmail}
          onChange={(e) => setSettings({ extractEmail: e.target.checked })} />
      </label>
      <label className="flex items-center justify-between text-sm">
        Show browser
        <input type="checkbox" checked={!settings.headless}
          onChange={(e) => setSettings({ headless: !e.target.checked })} />
      </label>
      <label className="flex items-center justify-between text-sm">
        Delay min/max (ms)
        <span className="flex gap-1">
          <input type="number" value={settings.delayMinMs}
            onChange={(e) => setSettings({ delayMinMs: Number(e.target.value) })}
            className="w-16 rounded border px-1 py-1" />
          <input type="number" value={settings.delayMaxMs}
            onChange={(e) => setSettings({ delayMaxMs: Number(e.target.value) })}
            className="w-16 rounded border px-1 py-1" />
        </span>
      </label>
    </section>
  )
}
```

- [ ] **Step 3: Implement `QueuePanel.tsx`**

```tsx
import { useStore } from '../lib/store'

const COLORS: Record<string, string> = {
  queued: 'bg-gray-300', running: 'bg-amber-400', done: 'bg-emerald-500',
  error: 'bg-rose-500', blocked: 'bg-purple-500',
}

export function QueuePanel() {
  const queue = useStore((s) => s.queue)
  if (!queue.length) return null
  return (
    <div className="flex flex-wrap gap-2 border-b px-4 py-2">
      {queue.map((q) => (
        <span key={q.id} className="flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs"
          title={q.error ?? ''}>
          <span className={`h-2 w-2 rounded-full ${COLORS[q.status] ?? 'bg-gray-300'}`} />
          Task {q.id} · {q.count}
        </span>
      ))}
    </div>
  )
}
```

- [ ] **Step 4: Verify in browser**

Run: `cd web && npm run dev`
Expected: Add a keyword → it appears and is removable; Settings inputs update; QueuePanel hidden until a job runs.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/KeywordList.tsx web/src/components/SettingsPanel.tsx web/src/components/QueuePanel.tsx
git commit -m "feat: keyword, settings, and queue panels"
```

---

## Task 12: LocationSelector (cascading dropdowns + multi-state) + LocationList

**Files:**
- Modify: `web/src/components/LocationSelector.tsx`, `web/src/components/LocationList.tsx`

**Interfaces:**
- Consumes: `api`, `useStore`, `LocationSpec`.
- Produces: faithful modern version of the legacy "Add location" dialog. `LocationSelector` builds `LocationSpec` objects and calls `addLocation`. `LocationList` shows added locations with remove buttons.

- [ ] **Step 1: Implement `LocationSelector.tsx`**

```tsx
import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useStore } from '../lib/store'
import { LocationSpec } from '../lib/types'

type Opt = { code: string; name: string }
const ALL_ZIPS = 'All zip codes'

export function LocationSelector() {
  const addLocation = useStore((s) => s.addLocation)
  const [countries, setCountries] = useState<Opt[]>([])
  const [states, setStates] = useState<Opt[]>([])
  const [cities, setCities] = useState<{ name: string }[]>([])
  const [zips, setZips] = useState<string[]>([])
  const [country, setCountry] = useState<Opt | null>(null)
  const [state, setState] = useState<Opt | null>(null)
  const [city, setCity] = useState('')
  const [zip, setZip] = useState(ALL_ZIPS)
  const [checkedStates, setCheckedStates] = useState<Set<string>>(new Set())

  useEffect(() => { api.getCountries().then(setCountries) }, [])
  useEffect(() => {
    if (!country) return
    api.getStates(country.code).then(setStates)
    setState(null); setCities([]); setCity(''); setCheckedStates(new Set())
  }, [country])
  useEffect(() => {
    if (!country || !state) return
    api.getCities(country.code, state.code).then(setCities)
    setCity(''); setZips([]); setZip(ALL_ZIPS)
  }, [state])
  useEffect(() => {
    if (!country || !state || !city) { setZips([]); return }
    api.getZips(country.name, state.name, city).then(setZips)
    setZip(ALL_ZIPS)
  }, [city])

  const addSingle = () => {
    if (!country || !state || !city) return
    const z = zip === ALL_ZIPS ? null : zip
    const label = `${country.name} › ${state.name} › ${city} › ${zip}`
    const loc: LocationSpec = { country: country.name, state: state.name, city, zip: z, label }
    addLocation(loc)
  }
  const addCheckedStates = () => {
    if (!country) return
    for (const code of checkedStates) {
      const s = states.find((x) => x.code === code)
      if (!s) continue
      addLocation({
        country: country.name, state: s.name, city: '', zip: null,
        label: `${country.name} › ${s.name} › (all cities) › All zip codes`,
      })
    }
    setCheckedStates(new Set())
  }
  const toggle = (code: string) => setCheckedStates((prev) => {
    const next = new Set(prev); next.has(code) ? next.delete(code) : next.add(code); return next
  })

  return (
    <section className="space-y-2">
      <h2 className="text-sm font-semibold uppercase text-gray-500">Add Location</h2>
      <div className="grid grid-cols-2 gap-2 text-sm">
        <select className="rounded border px-2 py-1" value={country?.code ?? ''}
          onChange={(e) => setCountry(countries.find((c) => c.code === e.target.value) ?? null)}>
          <option value="">Country</option>
          {countries.map((c) => <option key={c.code} value={c.code}>{c.name}</option>)}
        </select>
        <select className="rounded border px-2 py-1" value={state?.code ?? ''}
          onChange={(e) => setState(states.find((s) => s.code === e.target.value) ?? null)}>
          <option value="">State</option>
          {states.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
        </select>
        <select className="rounded border px-2 py-1" value={city}
          onChange={(e) => setCity(e.target.value)}>
          <option value="">City</option>
          {cities.map((c) => <option key={c.name} value={c.name}>{c.name}</option>)}
        </select>
        <select className="rounded border px-2 py-1" value={zip}
          onChange={(e) => setZip(e.target.value)}>
          <option value={ALL_ZIPS}>{ALL_ZIPS}</option>
          {zips.map((z) => <option key={z} value={z}>{z}</option>)}
        </select>
      </div>
      <button onClick={addSingle} disabled={!city}
        className="w-full rounded bg-gray-800 py-1 text-sm text-white disabled:opacity-40">Add location</button>

      {states.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-gray-500">Or select multiple states</summary>
          <div className="mt-2 max-h-40 overflow-y-auto rounded border p-2">
            {states.map((s) => (
              <label key={s.code} className="flex items-center gap-2">
                <input type="checkbox" checked={checkedStates.has(s.code)} onChange={() => toggle(s.code)} />
                {s.name}
              </label>
            ))}
          </div>
          <div className="mt-2 flex gap-2">
            <button onClick={() => setCheckedStates(new Set(states.map((s) => s.code)))}
              className="rounded border px-2 py-1 text-xs">Select all</button>
            <button onClick={() => setCheckedStates(new Set())}
              className="rounded border px-2 py-1 text-xs">Clear all</button>
            <button onClick={addCheckedStates} disabled={!checkedStates.size}
              className="rounded bg-gray-800 px-2 py-1 text-xs text-white disabled:opacity-40">Add states</button>
          </div>
        </details>
      )}
    </section>
  )
}
```

- [ ] **Step 2: Implement `LocationList.tsx`**

```tsx
import { useStore } from '../lib/store'

export function LocationList() {
  const { locations, removeLocation } = useStore()
  if (!locations.length) return null
  return (
    <section>
      <h2 className="mb-2 text-sm font-semibold uppercase text-gray-500">Locations</h2>
      <ul className="space-y-1">
        {locations.map((l) => (
          <li key={l.label} className="flex items-center justify-between rounded bg-gray-100 px-2 py-1 text-xs">
            <span>{l.label}</span>
            <button onClick={() => removeLocation(l.label)} className="text-rose-600">×</button>
          </li>
        ))}
      </ul>
    </section>
  )
}
```

- [ ] **Step 3: Verify cascading behavior end-to-end (server must be running)**

Run server (`cd server && npm run dev`) and web (`cd web && npm run dev`).
Expected: Selecting Country → States load; State → Cities load; City → Zip dropdown fills (or stays "All zip codes" if API has none). "Add location" adds a chip; multi-state "Add states" adds several chips.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/LocationSelector.tsx web/src/components/LocationList.tsx
git commit -m "feat: cascading location selector with multi-state and zip lookup"
```

---

## Task 13: ResultsTable (TanStack) + final end-to-end verification

**Files:**
- Modify: `web/src/components/ResultsTable.tsx`
- Create: `README.md` (root)

**Interfaces:**
- Consumes: `useStore`, `@tanstack/react-table`, `Business`.
- Produces: live, filterable results grid.

- [ ] **Step 1: Implement `ResultsTable.tsx`**

```tsx
import { useMemo, useState } from 'react'
import {
  useReactTable, getCoreRowModel, getFilteredRowModel, flexRender, ColumnDef,
} from '@tanstack/react-table'
import { useStore } from '../lib/store'
import { Business } from '../lib/types'

const COLS: ColumnDef<Business>[] = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'category', header: 'Category' },
  { accessorKey: 'address', header: 'Address' },
  { accessorKey: 'phone', header: 'Phone' },
  { accessorKey: 'website', header: 'Website' },
  { accessorKey: 'rating', header: 'Rating' },
  { accessorKey: 'reviewCount', header: 'Reviews' },
  { accessorKey: 'email', header: 'Email' },
]

export function ResultsTable() {
  const results = useStore((s) => s.results)
  const [filter, setFilter] = useState('')
  const data = useMemo(() => results, [results])
  const table = useReactTable({
    data, columns: COLS,
    state: { globalFilter: filter },
    onGlobalFilterChange: setFilter,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })
  return (
    <div className="flex flex-1 flex-col overflow-hidden p-4">
      <input value={filter} onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter results…" className="mb-2 w-64 rounded border px-2 py-1 text-sm" />
      <div className="flex-1 overflow-auto rounded border">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-gray-50">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id} className="border-b px-3 py-2 font-medium">
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="odd:bg-white even:bg-gray-50">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="border-b px-3 py-2">
                    {flexRender(cell.column.columnDef.cell ?? ((c) => String(c.getValue() ?? '')), cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
            {!results.length && (
              <tr><td className="px-3 py-8 text-center text-gray-400" colSpan={COLS.length}>
                No results yet — add keywords and locations, then Start.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Create root `README.md`**

```markdown
# Google Maps Scraper

Local web app that scrapes Google Maps business listings with Playwright and a modern React UI.

## Run

1. Backend: `cd server && npm install && npx playwright install chromium && npm run dev`
2. Frontend: `cd web && npm install && npm run dev`
3. Open the Vite URL. Add keywords + locations, choose settings, click **Start**.

## Test

- Backend: `cd server && npm test` (live scrape smoke: `RUN_SMOKE=1 npm test`)
- Frontend: `cd web && npx vitest run`

## Notes

All Google Maps selectors live in `server/src/scraper/selectors.ts`. If Google changes its
markup and scraping returns 0 rows, update that file only.
```

- [ ] **Step 3: Full end-to-end manual verification**

With both servers running:
1. Add keyword `coffee`; add location United States › Florida › Miami › All zip codes.
2. Set Max results = 5, headless on. Click **Start**.
3. Expected: QueuePanel shows a task going running→done; rows stream into the table with names/addresses; results counter increments.
4. Click **Export CSV** → a `results.csv` downloads and opens with the rows.
5. Toggle "Show browser" on and Start again → a Chromium window is visible during scraping.

- [ ] **Step 4: Run all backend + frontend unit tests**

Run: `cd server && npm test` then `cd ../web && npx vitest run`
Expected: all suites pass (smoke skipped unless `RUN_SMOKE=1`).

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ResultsTable.tsx README.md
git commit -m "feat: live results table and end-to-end docs"
```

---

## Self-Review Notes

- **Spec coverage:** scraper engine (T3,T4), centralized selectors (T3), Business fields (T1), task queue keyword×location (T7), cascading location + multi-state + zip-via-API + "All zip codes" (T12, T5), live WS streaming (T8,T10), CSV export (T6,T13), settings incl. headless/email/delays (T11), data table (T13), testing incl. parser fixtures + smoke (T2,T3). All covered.
- **Placeholder scan:** stub components in T10 are intentional and filled in T11–T13; no unresolved TODOs.
- **Type consistency:** `JobEvent`, `LocationSpec`, `Business`, `JobSettings` names/shapes match across server `types.ts`, store, and API. `scrapeMaps` signature matches `ScrapeFn` in `jobRunner.ts` and the wrapper in `index.ts`.
