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
  into one sequential task per (keyword × location) and runs them with an `AbortController` for stop.

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

- **Geo** (`server/src/geo/`): `geoData.ts` uses `country-state-city`; `zipLookup.ts` calls Zippopotam
  (`api.zippopotam.us/{cc}/{state}/{city}` — lowercase 2-letter codes) and caches JSON in
  `server/.geo-cache/`. WHOIS results cache in `server/.whois-cache/`.

- **Frontend state** is a single Zustand store (`web/src/lib/store.ts`). `useJobSocket` feeds WS
  `JobEvent`s into `applyEvent`; `useResults` fetches the paginated window. Results table uses
  `@tanstack/react-table` + `react-virtual`.

## Shared contract

`server/src/types.ts` and `web/src/lib/types.ts` are **hand-kept in sync** (no codegen). The `Business`,
`JobSettings`, `LocationSpec`, and `JobEvent` shapes must match on both sides or the WS/REST wire breaks.
Change both together.
