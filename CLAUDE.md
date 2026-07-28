# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Atlas** — a local web app that scrapes Google Maps business listings with Playwright (real Chromium)
and presents them in a React UI. Two independent packages: `server/` (Node/Express/TS backend) and
`web/` (Vite/React/TS frontend). They are wired together by the Vite dev proxy, not a monorepo tool.

## Commands

Backend (`cd server`):
- `npm run dev` — tsx watch, serves API + WebSocket on **http://localhost:5174**
- `npm test` — vitest. Live-scrape smoke test is gated: `RUN_SMOKE=1 npm test`
- `npm run build` / `npm start` — tsc to `dist/`, then run compiled
- First-time: `npm install && npx playwright install chromium`

Frontend (`cd web`):
- `npm run dev` — Vite dev server (proxies `/api` and `/ws` to :5174 — backend must be running)
- `npm run lint` — oxlint
- `npm run build` — `tsc -b && vite build`
- Test a single file: `npx vitest run src/lib/store.test.ts`

## Architecture

Data flows in one direction: **job request → queue → scraper → SQLite → paginated reads + WS counts → UI.**

- **Scaling is the central design constraint.** The app is built to handle millions of rows. Three rules
  fall out of this and must be preserved:
  1. Rows are persisted to disk (SQLite) as they arrive, never accumulated in memory.
  2. The WebSocket broadcasts a **throttled row `count`** (every ~400ms), *not* one message per row.
     See `handleEvent` in `server/src/index.ts`.
  3. The frontend never holds the full result set — it fetches a paginated, filtered window via
     `GET /api/results`, and CSV export **streams from the DB** (`GET /api/export/csv`) rather than
     buffering rows.

- **`server/src/index.ts`** is the composition root: constructs the store, runner, WS hub, and injects
  dependencies into `createApp`. Route handlers in `server/src/api/routes.ts` depend only on the
  `RouteDeps` interface — keep them decoupled from concrete classes for testability.

- **Job model:** a job = `keywords[] × locations[]`. `JobRunner` (`queue/jobRunner.ts`) expands these
  into sequential tasks and runs them with an `AbortController` for stop.

- **Grid segmentation is how yield is maximised.** A Google Maps text search returns at most ~120
  results for an area no matter its true size, so scraping a city as one query silently truncates.
  When `JobSettings.segment` is on, `expandSegmentedTasks` geocodes each location
  (`geo/geocode.ts` → Nominatim) and tiles its bounding box (`geo/grid.ts`) into one task per map
  viewport, each scraped via a `/@lat,lng,Nz` URL (`scraper/searchUrl.ts`). Measured: "dentist" in
  London returns 67 rows unsegmented, 197 from just two 5km tiles. Rules that fall out:
  1. **Tiles overlap by design**, so dedup is mandatory — identity is `Business.placeId`, Google's
     canonical place id parsed from the `!19s` URL segment. `ResultsStore.insert` upserts on it and
     returns whether the row was new; only new rows increment the UI count.
  2. **Longitude spacing must be computed per latitude row.** A degree of longitude is 111km at the
     equator but 57km at Stockholm. A fixed degree step silently halves coverage across northern
     Europe. See `kmPerDegLng` in `geo/grid.ts`.
  3. **Over `maxTiles`, the grid coarsens rather than truncating.** Truncation returns the bounding
     box's south-west corner — capping a London grid at 3 tiles once returned Woking dentists.
  4. `geocode.ts` uses Nominatim's **structured** params, never free-text `q`: "Berlin, Berlin,
     Germany" as free text resolves to a street, "Madrid, Madrid, Spain" to the national library.

- **Non-US scraping depends on `hl=en&gl=us`** being on every Maps URL. Without it Google localizes
  the UI and aria-labels become "Bewertung"/"Sterne" or "Note"/"avis", so `parseRating`'s `/star/i`
  and `/review/i` never match and every European row comes back with a null rating. Rating and review
  count live in **two sibling aria-labels** under `div.F7nice` — both must be read and joined.

- **Scraper pipeline** (`server/src/scraper/`): `mapsScraper.ts` drives Playwright (scroll feed →
  visit each detail page). Optional enrichment, controlled by `JobSettings`, runs in the same browser:
  `siteScraper.ts` (visits the business website) → `emailScraper.ts` (real email) + social/directory
  links; `ownerExtract.ts` + `whois.ts` derive an owner name (offline NLP via `compromise` + RDAP WHOIS).

- **All Google Maps DOM selectors live in `server/src/scraper/selectors.ts`.** This is the single source
  of truth. If scraping returns 0 rows after a Google markup change, fix only this file.

- **`server/src/db/store.ts`** (`ResultsStore`) uses the `node:sqlite` runtime builtin (loaded via
  `createRequire` so bundlers don't statically resolve it). It self-migrates: new `Business` columns
  are `ALTER TABLE`-added on startup. When adding a field to `Business` (`types.ts`), also add it to
  `COLUMNS`, the `CREATE TABLE`, the `added` migration list, and `toBusiness`. Sorting is restricted to
  the `SORTABLE` allowlist to prevent SQL injection via the `sortBy` query param.

- **Google Sheets export** (`server/src/sheets/`): pushes results into a chosen tab of a
  spreadsheet **shared with the service account** (Drive only lists those). Auth is a self-signed
  JWT (`auth.ts`) on `node:crypto` — no SDK, no new dependency. **`sheetTemplate.ts` is the single
  source of truth for sheet look and feel** (the Sheets analogue of `selectors.ts`): the 33 headers,
  the five outreach channel vocabularies, colours, dropdowns and conditional formats. Rules that
  fall out, each learned by breaking something:
  1. Columns are matched to `Business` fields **by header name, never by position**, so a tab's CRM
     columns survive an export. Reserved CRM headers resolve *before* Atlas fields — the channel
     columns are `FB Status`/`IG Status`/`LI Status` precisely because `Facebook`/`Instagram`/
     `LinkedIn` would collide with the existing URL fields under case-insensitive matching.
  2. The `Outreach` column holds a whole-column `ARRAYFORMULA` summarising all five channels.
     `values:append` writes the full row width, so it **overwrites that formula every time**. The
     formula is therefore (re)installed *after* appending — and the column must be **cleared first**,
     because cells appended as `""` still count as occupied and the array yields `#REF!`.
  3. Applying the template **appends** conditional-format rules rather than replacing them. Always
     delete existing rules first (`clearConditionalFormatRequests`) or stale rules stay pointing at
     repurposed columns. `scripts/migrate-sheet.ts --restyle` reapplies the template safely.
  4. **Every write of scraped data uses `valueInputOption=RAW`.** `USER_ENTERED` makes Sheets parse
     `+1 305-697-3490` as a formula, which fails and leaves `#ERROR!` in the cell — this happened to
     139 phone numbers when `migrate-sheet.ts` wrote rows through `updateValues` while that method
     still defaulted to `USER_ENTERED`. `updateValues` now defaults to `RAW`; the *only* call that
     passes `USER_ENTERED` is installing the `ARRAYFORMULA`. Recovery, if it happens again:
     `scripts/repair-formula-errors.ts` reads the originals back via `valueRenderOption=FORMULA`
     (the literal text survives as the cell's `userEnteredValue`) and rewrites them as RAW.
  5. Exports are capped at 50k rows (`MAX_EXPORT_ROWS`), checked *before* any write — Sheets caps a
     spreadsheet at 10M cells, and a half-written sheet is worse than a refusal. CSV handles larger.
  6. `Stage` (where the deal is) and the per-channel statuses are **orthogonal**. The dashboard's
     contact rate counts a non-empty `Outreach`, not `Status LIKE "Called*"`, which would describe
     only one of five channels.

- **Geo** (`server/src/geo/`): `geoData.ts` uses `country-state-city` — but that package maps cities
  onto only a handful of subdivisions for most non-US countries (GB: 3871 cities across 4 of its 247
  states), so `listStates` filters out subdivisions with no cities and memoizes the result (the scan
  costs ~3s for GB). `zipLookup.ts` calls Zippopotam
  (`api.zippopotam.us/{cc}/{state}/{city}` — lowercase 2-letter codes) and caches JSON in
  `server/.geo-cache/`. WHOIS results cache in `server/.whois-cache/`.

- **Frontend state** is a single Zustand store (`web/src/lib/store.ts`). `useJobSocket` feeds WS
  `JobEvent`s into `applyEvent`; `useResults` fetches the paginated window. Results table uses
  `@tanstack/react-table` + `react-virtual`.

## Shared contract

`server/src/types.ts` and `web/src/lib/types.ts` are **hand-kept in sync** (no codegen). The `Business`,
`JobSettings`, `LocationSpec`, and `JobEvent` shapes must match on both sides or the WS/REST wire breaks.
Change both together.
