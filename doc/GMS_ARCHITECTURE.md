# Architecture — Atlas (Google Maps Scraper)

**Status:** Living document — describes the system as implemented
**Companion docs:** `GMS_PRD.md` · `GMS_DESIGN.md` · `GMS_UX.md` · `../CLAUDE.md` (the
condensed rule sheet — this doc is the narrative version)

Data flows in one direction:

```
job request → queue → scraper (Playwright) → SQLite → paginated reads + WS counts → UI
                                                   └→ CSV stream / Sheets export
```

---

## 1. Packages & composition

- **`server/`** — Node/Express/TS, runs on **:5174** (API + WebSocket). `npm run dev` (tsx
  watch), `npm test` (vitest; live-scrape smoke gated behind `RUN_SMOKE=1`).
- **`web/`** — Vite/React/TS. Dev server proxies `/api` and `/ws` to :5174. `npm run lint`
  is oxlint.
- **`server/src/index.ts` is the composition root**: constructs `ResultsStore`, `JobRunner`,
  the WS hub, sheets services, and injects them into `createApp`. Route handlers in
  `api/routes.ts` depend only on the **`RouteDeps` interface** — testable with stubs, never
  concrete classes.
- **Shared contract:** `server/src/types.ts` ↔ `web/src/lib/types.ts` are **hand-kept in
  sync** (no codegen). `Business`, `JobSettings`, `LocationSpec`, `JobEvent` must match on
  both sides or the WS/REST wire breaks. Change both together.

## 2. Scaling rules (the central design constraint)

Built for millions of rows; three rules fall out and must be preserved:

1. Rows persist to disk (SQLite) **as they arrive** — never accumulated in memory.
2. The WS broadcasts a **throttled `count`** (~400ms; see `handleEvent` in `index.ts`) —
   never one message per row.
3. The frontend holds only a **paginated, filtered window** (`GET /api/results`); CSV export
   **streams from the DB** (`GET /api/export/csv`).

## 3. Job model & queue (`queue/jobRunner.ts`)

A job = `keywords[] × locations[]`, expanded into sequential `TaskSpec`s run under one
`AbortController` (stop = abort). Settings are normalized/clamped server-side
(`normalizeSettings`) so a partial client payload can't crash a run. Task events
(`task-update`, `row`, `count`, `progress`, `job-done`) flow to the WS hub.

### Grid segmentation (how yield is maximised)

A Maps text search returns ~120 results max regardless of area, silently truncating cities.
With `segment` on, `expandSegmentedTasks`:

- geocodes each location (`geo/geocode.ts` → Nominatim, **structured params only** — free-text
  `q` resolves "Berlin, Berlin, Germany" to a street),
- tiles the bounding box (`geo/grid.ts`) into one task per viewport, scraped via a
  `/@lat,lng,Nz` URL (`scraper/searchUrl.ts`).

Rules learned the hard way:
1. **Tiles overlap by design** → dedup is mandatory; identity is `Business.placeId` parsed
   from the `!19s` URL segment. `ResultsStore.insert` upserts on it; only new rows increment
   the UI count.
2. **Longitude spacing is computed per latitude row** (`kmPerDegLng`) — a fixed degree step
   halves coverage across northern Europe.
3. **Over `maxTiles` the grid coarsens, never truncates** — truncation once returned Woking
   dentists for a London search capped at 3 tiles.

## 4. Scraper pipeline (`scraper/`)

`mapsScraper.ts` drives Playwright: scroll the results feed → visit each detail page →
build a `Business`. Optional enrichment runs in the same browser per `JobSettings`:
`siteScraper.ts` (business website) → `emailScraper.ts` (real email) + social/directory
links; `ownerExtract.ts` (+ `whois.ts` RDAP) derives owner name/title offline via
`compromise`.

Invariants:
- **All Maps DOM selectors live in `scraper/selectors.ts`** — the single source of truth.
  Zero rows after a Google markup change → fix only this file.
- **Every Maps URL carries `hl=en&gl=us`** — otherwise Google localizes aria-labels
  ("Bewertung"/"Sterne") and `parseRating`'s `/star/i` + `/review/i` never match, nulling
  every European rating. Rating and review count are **two sibling aria-labels** under
  `div.F7nice`, both read and joined.

## 5. Store (`db/store.ts`)

`ResultsStore` on the `node:sqlite` builtin (loaded via `createRequire` so bundlers don't
resolve it statically). Self-migrating: new columns are `ALTER TABLE`-added on startup.

**Adding a `Business` field — the full checklist** (miss one and the field half-exists):
`types.ts` (both sides) → `COLUMNS` → `CREATE TABLE` → the `added` migration list →
`emptyBusiness` → (if sortable) the `SORTABLE` allowlist → `export/csv.ts ALL_COLUMNS`
(which also feeds the Sheets template headers).

Other rules: `SORTABLE` is an allowlist (SQL-injection guard on `sortBy`); duplicate
re-sightings **merge** — text columns blank-fill via CASE-WHEN, numeric via COALESCE, never
clobbering existing data; `placeId` is a unique index with NULLs distinct (unidentifiable
rows never collapse into each other).

## 6. API surface (`api/routes.ts`)

| Route | Purpose |
|---|---|
| `GET /api/geo/countries·states·cities·zips` | cascading pickers (see §8) |
| `GET /api/results` | paginated + filtered + sorted window (`ResultQuery`) |
| `GET /api/results/ids` | id list for selection features |
| `POST /api/job/start` / `job/stop` | run control |
| `POST /api/results/clear` | wipe the DB |
| `GET /api/export/csv` | streamed CSV |
| `GET /api/sheets/spreadsheets` / `sheets/:id/tabs` | export destination pickers |
| `POST /api/export/sheets` | (split) export |

## 7. Google Sheets export (`sheets/`)

Auth: self-signed RS256 JWT on `node:crypto` (`auth.ts`) — no SDK. Drive lists only
spreadsheets **shared with the service account**. `sheetTemplate.ts` is the single source of
truth for the tab's look (35 headers, Stage + five channel vocabularies, colours, dropdowns,
conditional formats) — the Sheets analogue of `selectors.ts`.

Battle-tested rules (each learned by breaking a real sheet):
1. Columns match **by header name, never position**; reserved CRM headers resolve before
   Atlas fields (hence `FB Status` not `Facebook` — case-insensitive collision).
2. The `Outreach` column is a whole-column `ARRAYFORMULA`; `values:append` overwrites it, so
   it is **cleared then reinstalled after appending** (cells appended as `""` count as
   occupied → `#REF!`).
3. Template application **deletes existing conditional-format rules first** or stale rules
   haunt repurposed columns; `scripts/migrate-sheet.ts --restyle` reapplies safely.
4. **All scraped-data writes are `valueInputOption=RAW`** — USER_ENTERED parses
   `+1 305-…` as a formula (`#ERROR!` on 139 phones, recovered via
   `scripts/repair-formula-errors.ts` + `valueRenderOption=FORMULA`). The only USER_ENTERED
   call installs the ARRAYFORMULA.
5. Exports cap at 50k rows (`MAX_EXPORT_ROWS`) **before any write**; CSV handles larger.
6. `Stage` and per-channel statuses are **orthogonal**; contact rate = non-empty `Outreach`.
7. Split export distributes by integer percents summing to 100, deduping across **all**
   target tabs (optionally placeId-scoped).

## 7b. Phone line type (`phone/`)

Every scraped phone classifies offline to `mobile`/`landline`/`voip`/`unknown` + carrier via
the committed NPA-NXX snapshot (`data/npanxx.json.gz`; `npm run linetype:build` regenerates
it from NANPA + localcallingguide). `lineType.ts` is the single source of truth for the
rules, incl. the VoIP carrier allowlist; the snapshot loads lazily and degrades to `unknown`
when absent. Classification runs at row-finalize in `mapsScraper.ts` — never in the store.
Non-NANP numbers are `unknown`, never guessed; the type is the prefix's *original* carrier
assignment (ported numbers may differ — surfaced as a tooltip caveat). The `unknown` filter
also matches blank pre-backfill rows; `npm run linetype:backfill` classifies them
(self-migrating, idempotent).

## 8. Geo (`geo/`)

`geoData.ts` wraps `country-state-city`, which maps cities onto only a few subdivisions for
most non-US countries (GB: 3871 cities across 4 of 247 states) — so `listStates` filters
subdivisions with no cities and memoizes (the GB scan costs ~3s). `zipLookup.ts` calls
Zippopotam (`api.zippopotam.us/{cc}/{state}/{city}`, lowercase codes), cached in
`server/.geo-cache/`. WHOIS caches in `server/.whois-cache/`.

## 9. Frontend (`web/src/`)

- **State:** one Zustand store (`lib/store.ts`). `useJobSocket` feeds WS `JobEvent`s into
  `applyEvent`; `useResults` fetches the paginated window; `lib/api.ts` wraps REST.
- **Layout (`App.tsx`):** TopBar; left sidebar (KeywordList, LocationSelector, LocationList,
  SettingsPanel); main column (QueuePanel over ResultsTable).
- **Results table:** `@tanstack/react-table` + `react-virtual` — rendering stays flat at any
  row count. Row selection with shift-range feeds the split-export dialog.

## 10. Testing conventions

Vitest both packages. Stores test against `:memory:` SQLite; sheets/geo tests inject `fetch`;
the live-scrape smoke is opt-in (`RUN_SMOKE=1`). Route tests stub `RouteDeps`. No test hits
the network by default.
