# Atlas — Google Maps Data Console

A local web app that scrapes Google Maps business listings with Playwright and presents them in a
modern React UI. Built to replace a legacy PhantomJS-based tool whose scraping logic targeted a
retired version of Google Maps.

## Features

- **Real Chromium scraping** via Playwright — works against today's Google Maps.
- **Cascading location picker** — Country → State → City → Zip (with "All zip codes"), plus
  multi-state bulk selection.
- **Task queue** — one task per (keyword × location), run sequentially.
- **Live streaming** of results over WebSocket as they're scraped.
- **CSV export** of all collected rows.
- Fields: name, address, phone, website, rating, reviews, price level, category, hours, email.

## Run

1. **Backend:** `cd server && npm install && npx playwright install chromium && npm run dev`
   (serves on http://localhost:5174)
2. **Frontend:** `cd web && npm install && npm run dev` (open the Vite URL)
3. Add keywords + plot locations, choose settings, click **Start survey**.

## Test

- Backend: `cd server && npm test` (live scrape smoke: `RUN_SMOKE=1 npm test`)
- Frontend: `cd web && npx vitest run`

## Maintenance

All Google Maps DOM selectors live in **`server/src/scraper/selectors.ts`**. If Google changes its
markup and scraping returns 0 rows, update that one file.
