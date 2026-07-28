# Export to Google Sheets — Design

**Date:** 2026-07-28
**Status:** Approved, ready for implementation planning

## Problem

Atlas can only export results as a downloaded CSV. Leads are worked in Google Sheets, so
every run means a manual download-and-paste that discards the sheet's structure — its
`Status`/`Priority`/`Notes` columns, dropdowns, and conditional formatting.

Export must offer a second destination: push straight into a chosen tab of a chosen
spreadsheet, preserving that tab's existing look, feel, and column structure.

## Goals

- Export button offers a choice: download CSV (unchanged) or write to Google Sheets.
- Picking Sheets shows the available spreadsheets, then the tabs within the chosen one.
- Rows land in the selected tab without disturbing its formatting or its CRM columns.
- Selecting an empty tab (or creating a new one) produces a fully styled tab.

## Non-goals

- Exporting the filtered/sorted view. Export sends **all** stored rows, matching the CSV
  route. Filter-aware export is a possible follow-up.
- Two-way sync. This is one-directional, Atlas → Sheets.
- Scheduled or automatic export.
- OAuth sign-in. See "Authentication" below.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Authentication | Service-account key | Zero user interaction, works headless, key already exists and is proven against these sheets. |
| Write mode | Append new rows only | Never destroys a rep's in-progress `Status`/`Notes`. |
| Empty/new tabs | Auto-build full styled structure | One-click onboarding for a new rep. |
| Bulk strategy | Batched append with a row cap | Keeps memory bounded; honest about Sheets' hard limits. |
| Dependencies | None added | ~40 lines on `node:crypto` + `fetch` beats a ~50MB `googleapis` tree. |

### Authentication

Google service account. The picker can only list spreadsheets **explicitly shared with the
service-account email**, which is a real constraint the UI must make visible rather than
hide: when the list is empty or a 403 occurs, the dialog displays the address to share with.

Key location is `GOOGLE_SERVICE_ACCOUNT_KEY`, defaulting to
`server/.google-service-account.json`. The token is a self-signed JWT exchanged at
`oauth2.googleapis.com/token`, cached in memory until 60s before expiry.

Scopes: `spreadsheets` (read/write) and `drive.metadata.readonly` (to list spreadsheets).

## Architecture

New module `server/src/sheets/`, four files with one responsibility each:

| File | Responsibility |
|---|---|
| `auth.ts` | JWT signing, token exchange, expiry-aware cache. |
| `client.ts` | REST wrapper on `fetch`: `listSpreadsheets`, `getTabs`, `appendValues`, `batchUpdate`. Retries 429/5xx with exponential backoff. |
| `sheetTemplate.ts` | **Single source of truth for look and feel** — headers, colours, widths, dropdowns, conditional-format rules. |
| `exporter.ts` | Orchestration: header mapping → dedup → batched append → summary. |

`sheetTemplate.ts` plays the same role for sheet styling that `selectors.ts` plays for the
Maps DOM: when the design changes, exactly one file changes.

### Route wiring

Handlers depend only on a new `sheets` member of `RouteDeps`, per the existing decoupling
rule. `index.ts` constructs the client and injects it alongside store/runner/hub.

```
GET  /api/sheets/spreadsheets        -> { id, name }[]
GET  /api/sheets/:id/tabs            -> { sheetId, title, rowCount }[]
POST /api/export/sheets              -> { appended, skipped, total }
     body: { spreadsheetId, sheetTitle, createNew?: boolean }
     // sheetTitle names the target tab; with createNew:true it names the tab to create
```

## Column mapping

The exporter never assumes column positions. It reads **row 1 of the target tab** and builds
a `header -> columnIndex` map, matching case-insensitively (trimmed) against the 24
`Business` keys in `ALL_COLUMNS`.

For the current `Faizan` tab (27 headers) this resolves as:

- `name` -> column A
- the 23 remaining Atlas fields -> columns E..AA
- `Status`, `Priority`, `Notes` match no `Business` key and are **left untouched**

Appended rows are built at the full width of the header row. Cells for unmatched headers are
written empty, except `Status`, which is seeded to `New` so new rows appear in the
dashboard's New bucket and pick up the grey `New` conditional format.

A tab with columns in a different order, or with extra columns, works without change —
mapping is by name, never by index.

### Styling of appended rows

No per-row formatting calls are needed. The existing data validation and the 14 conditional
format rules already span rows 1–1000, and body text formatting was applied over the same
range, so appended rows inherit the look automatically.

## Dedup

Identity is `placeId`, consistent with `ResultsStore.insert`. The sheet has no `placeId`
column, but `mapsUrl` embeds it in the `!19s` segment. The exporter therefore:

1. Reads the existing `mapsUrl` column from the target tab.
2. Extracts placeIds using the same `!19s` parser the scraper uses.
3. Skips any business whose placeId is already present.

Fallback when the tab has no `mapsUrl` column: a composite `name + address` key.

## Data flow and limits

```
ResultsStore.iterateAll(1000)
  -> accumulate into 5,000-row chunks
  -> POST values:append (valueInputOption=RAW) per chunk
  -> tally appended / skipped
```

Memory stays bounded exactly as in the CSV path; the full result set is never held at once.
`RAW` is required — `USER_ENTERED` would try to parse a leading-`+` phone number as a formula.

**Row cap.** Google caps a spreadsheet at 10M cells (~370k rows at 27 columns), and append
degrades well before that. A configurable ceiling (default **50,000 rows**) is checked
*before* any write. Over the cap, the request is refused with a message directing the user to
CSV. Refusing up front beats a half-written sheet.

## Error handling

| Condition | Response |
|---|---|
| Key file missing/unreadable | 503, "Google Sheets export is not configured." |
| Spreadsheet not shared with the service account (403) | First-class UI state showing the service-account email to share with — the most likely real-world failure, not an error to bury. |
| 429 / 5xx from Google | Exponential backoff, 3 attempts. |
| Failure partway through | Report rows successfully written so the user knows what landed. |
| Row count over cap | 413 with the count and a pointer to CSV. |

The POST is synchronous, returning `{ appended, skipped, total }`. At the 50k cap that is
~10 requests. WebSocket progress events are deliberately excluded: they would require
changing the hand-synced `JobEvent` contract on both sides for little gain, and can be added
later if it proves slow.

## UI

`TopBar.tsx`'s `<a download>` becomes a button opening a new `web/src/components/ExportDialog.tsx`:

1. **Destination** — CSV (triggers the existing download, unchanged) or Google Sheets.
2. **Spreadsheet** — fetched list, with the share-with hint.
3. **Tab** — fetched list with row counts, plus "+ New tab…" and a name input.
4. **Summary** — "112 appended, 38 skipped (already present)."

Styled with existing Tailwind tokens (`border-line`, `text-parchment`, teal accents).
Dialog state is local to the component; only the resulting counts touch the Zustand store.

## Fixes folded in

### Icon-glyph contamination (root cause)

Scraped `address`, `phone`, and `hours` values begin with a Unicode Private Use Area
codepoint (`U+E0C8` address, `U+E0B0` phone) — Google's Material icon glyphs captured as
text. 142 of 150 cells in the live sheet were affected. `trim()` cannot remove them because
they are not whitespace.

Fix in `listingParser.ts` field extraction: strip `[\ue000-\uf8ff]` and collapse whitespace
runs. This cleans the DB at source, so **both** CSV and Sheets output benefit. A defensive
strip also runs in the sheets writer. Regression test required.

### Credential hygiene

`n8n-chatbot.json` is an untracked live private key at the repo root that nothing ignores —
one `git add .` from being committed. Move to `server/.google-service-account.json` and add
both paths to `.gitignore`.

## Testing

Unit tests against a faked client, no live API calls:

- Header mapping: correct field→column resolution; `Status`/`Priority`/`Notes` preserved;
  unknown headers ignored; case-insensitive matching.
- `Status` seeded to `New` on appended rows.
- Dedup: placeId extracted from `mapsUrl`; duplicates skipped; fallback key when no
  `mapsUrl` column.
- Template: generates expected header, validation, and conditional-format requests.
- Row cap rejection.
- Retry/backoff on 429.
- `listingParser`: PUA glyphs stripped (regression).

Route tests via the existing `supertest` devDependency against a fake `deps.sheets`.

A live round-trip smoke test is gated behind `RUN_SHEETS_SMOKE=1`, mirroring the existing
`RUN_SMOKE` convention.

## Files touched

**New**
- `server/src/sheets/{auth,client,sheetTemplate,exporter}.ts`
- `server/test/sheets/{mapping,dedup,template,exporter}.test.ts`
- `web/src/components/ExportDialog.tsx`

**Modified**
- `server/src/api/routes.ts` — 3 routes, `RouteDeps.sheets`
- `server/src/index.ts` — construct and inject
- `server/src/scraper/listingParser.ts` — PUA strip
- `server/test/listingParser.test.ts` — regression case
- `web/src/components/TopBar.tsx` — button opens dialog
- `web/src/lib/api.ts` — 3 client methods
- `web/src/lib/types.ts` — export request/response types (mirror in `server/src/types.ts`)
- `.gitignore` — credential paths
- `CLAUDE.md` — document the sheets module and `sheetTemplate.ts` as styling SSoT
