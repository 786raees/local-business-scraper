# PRD — Atlas (Google Maps Scraper)

**Status:** Living document — describes the product as implemented
**Owner:** Waqar Khan
**Companion docs:** `GMS_ARCHITECTURE.md` · `GMS_DESIGN.md` · `GMS_UX.md` ·
feature stories in `gms_stories/`

---

## 1. What Atlas is

A **local web app that scrapes Google Maps business listings** with real Chromium
(Playwright) and turns them into an outreach-ready lead database. Two packages — a
Node/Express/TS backend (`server/`, port 5174) and a Vite/React/TS frontend (`web/`) — wired
by the Vite dev proxy. Everything runs on the user's machine; the only external services are
Google Maps (scraped), Nominatim/Zippopotam/RDAP (free lookups), and the Google Sheets API
(export).

**The user:** a lead-gen operator building B2B outreach lists ("dentists in London",
"plumbers in Miami") who needs volume, dedup, contact enrichment, and a clean handoff to
outreach tools — the Google Voice Quick Dial extension consumes Atlas's Sheets exports
directly (see `CHROME_EXTENSION_PRD.md`).

## 2. Goals (as built)

1. **Yield** — beat Google's ~120-results-per-search cap via grid segmentation: tile a
   location's bounding box into map viewports and search each tile. Measured: "dentist" in
   London — 67 rows unsegmented vs 197 from just two 5km tiles.
2. **Scale** — handle millions of rows: persist to SQLite as rows arrive, throttled WS
   counts (never per-row messages), paginated reads, streamed CSV export.
3. **Data quality** — dedup on Google's canonical `placeId` across overlapping tiles;
   merge re-sightings (fill blanks, never clobber); locale-proof parsing (`hl=en&gl=us`).
4. **Enrichment (optional per job)** — visit the business website for a real email +
   social/directory links; derive an owner name via offline NLP (`compromise`) + RDAP WHOIS.
   Every phone also classifies to a **line type** (mobile/landline/voip/unknown + carrier)
   offline from the NPA-NXX prefix database — filterable, sortable, exported.
5. **Outreach handoff** — CSV streaming for arbitrary size; Google Sheets export into a
   styled CRM template (Stage, five channel-status columns, Outreach summary formula,
   dropdowns, conditional colours), incl. split export across tabs with cross-tab dedup and
   CSV lead import.

## 3. Core flows (implemented)

| Flow | Summary |
|---|---|
| Build a job | keywords[] × locations[] (country → state → city → optional zips via Zippopotam) + settings (max results, segmentation, tile size, delays, enrichment toggles, headless) |
| Run | queue expands to sequential tasks; live queue panel; throttled result counter; stop via AbortController |
| Review | paginated, filtered, sorted results table (virtualized); filters: text, category, min rating/reviews, has email/website/phone |
| Export CSV | streams the current filter from the DB — no size limit |
| Export Sheets | into tabs of a spreadsheet shared with the service account; template applied; capped at 50k rows/export; split-by-percent across tabs with placeId-scoped dedup |
| Import | CSV lead import with normalised fallback identity |

## 4. Constraints & product stances

- **Scraping is inherently fragile** — all Google Maps DOM knowledge is quarantined in one
  file (`scraper/selectors.ts`); a markup change is a one-file fix.
- **Be a polite scraper** — randomized delays between tasks; per-job result budget.
- **Sheets safety over convenience** — RAW writes only (USER_ENTERED corrupted 139 phone
  numbers once), header-name column matching so users' CRM edits survive, export cap
  before any write.
- **Local-first** — no accounts, no server, no telemetry; the DB is a file
  (`server/results.db`), caches are directories (`.geo-cache/`, `.whois-cache/`).

## 5. Roadmap (not yet implemented)

Feature ideas graduate into numbered stories in `gms_stories/` when picked up.
(Phone line-type detection shipped via gms stories 00–05; the extension-side display is
extension story 13.) Current backlog candidates:

- Callback/date columns and deeper CRM sync with the Quick Dial extension.
- Multi-phone capture per business; scheduled re-scrapes; proxy support.
