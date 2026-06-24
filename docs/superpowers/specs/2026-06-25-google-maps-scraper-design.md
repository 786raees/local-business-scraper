# Google Maps Scraper — Design Spec

**Date:** 2026-06-25
**Location:** `C:\Users\CodingCops\Desktop\projects\leaning\google map scraper\`

## Context

The user owns a legacy desktop tool, "Google Maps Extractor Pro" (a cracked, obfuscated
.NET/PhantomJS build). It still launches and runs, but extracts **zero data**. Investigation
proved why: its scraping logic targets a retired version of Google Maps.

- Its `index.js` calls `document.getElementById('section-pagination-button-next')` — an element
  Google removed years ago (returns `null`, the click throws, the run yields nothing).
- Its network-capture path listens for `www.google.com/search?tbm=map&fp=` requests; modern Maps
  uses `…tbm=map&…pb=` (protobuf). That capture never fires.
- PhantomJS (discontinued 2018) can load the page but cannot render the JS-driven results feed.

The fix is not configuration — it is a rewrite. This project replaces the dead tool with a
modern, maintainable scraper plus a polished UI. The single biggest maintainability goal:
**all Google Maps selectors live in one module** so markup changes are a one-file fix.

## Goals

- Reliably extract Google Maps business listings using a real Chromium browser (Playwright).
- A modern, attractive local web UI that surpasses the old WinForms look.
- Faithfully reproduce the old tool's **cascading location picker** (Country → State → City → Zip,
  plus multi-state select), modernized.
- Live-streaming results, task queue, and CSV export.

## Non-Goals (YAGNI)

- Excel/JSON/MySQL export (CSV only).
- Authentication, multi-user, cloud hosting.
- Packaging as a native installer (run locally via dev/start scripts).

## Architecture

Local web app, two parts:

```
google map scraper/
├── server/                 Node + TypeScript backend
│   ├── src/
│   │   ├── scraper/        Playwright engine
│   │   │   ├── selectors.ts        ALL Google Maps selectors (single source of truth)
│   │   │   ├── mapsScraper.ts      search → scroll feed → extract listings
│   │   │   ├── listingParser.ts    pure DOM→Business mappers (unit-testable)
│   │   │   └── emailScraper.ts     optional: visit website, regex email
│   │   ├── queue/          task queue (keyword × location), sequential runner
│   │   ├── geo/            zip lookup (Zippopotam → GeoNames fallback) + cache
│   │   ├── api/            Express REST routes
│   │   ├── ws/             WebSocket hub (progress + streamed rows)
│   │   ├── export/         CSV writer
│   │   └── index.ts        server bootstrap
│   └── test/               vitest unit + one integration smoke test
└── web/                    React + Vite + Tailwind + shadcn/ui
    └── src/
        ├── components/     LocationSelector, KeywordList, ResultsTable, QueuePanel, SettingsPanel, TopBar
        ├── hooks/          useWebSocket, useScrapeJob
        ├── lib/            api client, csv download, types
        └── App.tsx
```

Backend drives Playwright Chromium (headless by default, toggleable to visible). Frontend talks to
it over REST (jobs, geo, export) + WebSocket (live progress and rows).

## Scraper Engine

For each task (keyword + resolved location string):
1. Navigate to `https://www.google.com/maps/search/<keyword> <location>` with a realistic UA.
2. Dismiss cookie-consent interstitial if present (selector in `selectors.ts`).
3. **Scroll the results feed panel** repeatedly, waiting for new listing cards to lazy-load, until
   no new cards appear or `maxResults` is reached.
4. For each card, extract from the live DOM: **name, address, phone, website, rating, reviewCount,
   priceLevel, category, hours**. Parsing is done by pure functions in `listingParser.ts`.
5. If **extractEmail** is on, open each business `website` in a new page and regex-scan for an email.
6. Stream each completed `Business` over WebSocket; also retain server-side for export.

Anti-blocking: realistic user-agent, randomized human-like delay (configurable range), optional
concurrency limit (default 1 task at a time). On hard block/CAPTCHA, the task is marked `blocked`
and the UI suggests enabling the visible browser and increasing delays.

### Business record (fields)

```
name, address, phone, website, rating, reviewCount, priceLevel,
category, hours, email (optional), mapsUrl, keyword, location
```

## Task Queue Model

- UI holds two collections: **Keywords** and **Locations** (add / edit / delete / select).
- Backend generates **one task per (selected keyword × selected location)**.
  - A location with "All zip codes" runs the city-level search.
  - A location with a specific zip appends that zip to the query.
  - Multi-state selection expands to one location (and thus task set) per checked state.
- Tasks run **sequentially** through a queue. Each task has status:
  `queued → running → done | error | blocked`, with a per-task result count.
- Global progress bar + total-results counter in the top bar; Start / Stop controls.

## Location Selector (modeled on the legacy "Add location" dialog)

- **Country → State → City** cascading dropdowns, populated offline from the
  `country-state-city` npm dataset.
- **Zip code** dropdown, first entry **"All zip codes"** (default; zip optional). On city
  selection, zips are fetched via the backend `/api/geo/zips` endpoint (Zippopotam primary,
  GeoNames fallback), cached on disk to avoid repeat calls and rate limits.
- **"Or select multiple states"** — scrollable checkbox list with **Select all / Clear all**;
  each checked state is added as its own location entry.
- Confirmed locations render as chips/rows: `United States › Florida › Miami › 33137`
  (or `… › All zip codes`).

## Frontend (beautiful, modern)

- shadcn/ui + Tailwind, dark/light theme, responsive.
- **Layout:** left sidebar (Keywords, Locations + LocationSelector, Settings) → main area with a
  live, sortable/filterable **results data table** → top bar (Start/Stop, queue chips, progress,
  totals).
- Live row streaming, toast notifications, empty/loading/error states.
- **Export CSV** button honoring chosen visible/export columns.
- Settings: maxResults per task, extractEmail toggle, headless toggle, delay range (min/max ms).

## Data Flow & Error Handling

- One scrape job → a WebSocket channel; rows streamed live and retained server-side for export.
- Per-listing failures are logged and skipped — one bad card never aborts a task.
- Per-task errors surface in the queue UI with a readable reason.
- Geo API failures fall back (Zippopotam → GeoNames) then degrade to free-text zip entry.

## Testing

- **Unit (vitest):** `listingParser.ts` against saved Maps HTML fixtures — no network. Cover
  missing-field cases (no phone, no website, no rating).
- **Geo:** unit-test zip normalization/caching with a mocked fetch.
- **Integration smoke:** one real small headless search asserts ≥1 row with a non-empty name.
- **Manual E2E:** run app → add keyword "plumbing" + location Miami/FL → Start → watch rows stream
  → Export CSV → open and verify.

## Tech / Tooling

- Node 24, TypeScript, Playwright (Chromium), Express, `ws`, `country-state-city`, vitest.
- React 18 + Vite + Tailwind + shadcn/ui, TanStack Table for the results grid.
- Geo APIs: Zippopotam.us (no key) primary, GeoNames fallback.

## Open Risks

- Google may change Maps markup → mitigated by centralized `selectors.ts`.
- Heavy scraping can trigger blocks → mitigated by delays, headless toggle, single-task concurrency.
- Email extraction is slow and best-effort by nature.
