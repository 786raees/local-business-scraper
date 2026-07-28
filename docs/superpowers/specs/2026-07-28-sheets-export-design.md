# Export to Google Sheets — Design

**Date:** 2026-07-28
**Status:** Approved, ready for implementation planning
**Revision:** 2 — extends the single cold-call `Status` column to a five-channel outreach model

## Problem

Atlas can only export results as a downloaded CSV. Leads are worked in Google Sheets, so
every run means a manual download-and-paste that discards the sheet's structure — its
CRM columns, dropdowns, and conditional formatting.

Export must offer a second destination: push straight into a chosen tab of a chosen
spreadsheet, preserving that tab's existing look, feel, and column structure.

Additionally, the current `Status` column only models cold calling. The team also works
leads over SMS, Facebook, Instagram, and LinkedIn, and needs to record the state of several
channels on the same lead.

## Goals

- Export button offers a choice: download CSV (unchanged) or write to Google Sheets.
- Picking Sheets shows the available spreadsheets, then the tabs within the chosen one.
- Rows land in the selected tab without disturbing its formatting or its CRM columns.
- Selecting an empty tab (or creating a new one) produces a fully styled tab.
- A lead can carry an independent outreach status for each of five channels, readable from
  a single summary column.

## Non-goals

- Exporting the filtered/sorted view. Export sends **all** stored rows, matching the CSV
  route. Filter-aware export is a possible follow-up.
- Two-way sync. This is one-directional, Atlas → Sheets.
- Scheduled or automatic export.
- OAuth sign-in. See "Authentication" below.
- Per-touch history (timestamps, who called when). The sheet records current state per
  channel, not an activity log.

## Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Authentication | Service-account key | Zero user interaction, works headless, key already exists and is proven against these sheets. |
| Write mode | Append new rows only | Never destroys a rep's in-progress statuses or notes. |
| Empty/new tabs | Auto-build full styled structure | One-click onboarding for a new rep. |
| Bulk strategy | Batched append with a row cap | Keeps memory bounded; honest about Sheets' hard limits. |
| Dependencies | None added | ~40 lines on `node:crypto` + `fetch` beats a ~50MB `googleapis` tree. |
| Multi-channel model | One single-select column per channel + derived summary | The Sheets API cannot create multi-select dropdowns (verified — see below). |

### Authentication

Google service account. The picker can only list spreadsheets **explicitly shared with the
service-account email**, which is a real constraint the UI must make visible rather than
hide: when the list is empty or a 403 occurs, the dialog displays the address to share with.

Key location is `GOOGLE_SERVICE_ACCOUNT_KEY`, defaulting to
`server/.google-service-account.json`. The token is a self-signed JWT exchanged at
`oauth2.googleapis.com/token`, cached in memory until 60s before expiry.

Scopes: `spreadsheets` (read/write) and `drive.metadata.readonly` (to list spreadsheets).

## Multi-channel outreach model

### Why not one multi-select column

Verified empirically against the live spreadsheet:

- Google Sheets supports native multi-select dropdowns in the **UI**, but the v4 API rejects
  every multi-select field shape (`multiSelect`, `valueListMultiSelect`) with
  `Invalid JSON payload received. Unknown name`. A plain `ONE_OF_LIST` round-trips with no
  multi-select flag in the schema. **The API cannot create them.**
- `strict: true` constrains only UI entry, not API writes. A comma-joined value written via
  the API into a strict single-select cell is accepted, but a rep typing the same string by
  hand is rejected. A single comma-joined column would therefore work for Atlas and fail for
  the team.

Because Atlas must be able to build a fully styled tab from scratch, any scheme requiring
manual UI setup per tab is rejected.

### Two orthogonal concepts

The existing column conflates them, which is why adding channels felt awkward:

- **Stage** — where the deal is. One value per lead. Drives the dashboard funnel.
- **Channel status** — how outreach on one specific channel went. Independent per channel.

A lead can be `FB: Replied` and `Stage: Demo Booked` simultaneously.

### Column layout (rep tab)

| Col | Header | Type |
|---|---|---|
| A | `name` | Atlas field |
| B | `Stage` | single-select, 9 values |
| C | `Call Status` | single-select |
| D | `SMS Status` | single-select |
| E | `FB Status` | single-select |
| F | `IG Status` | single-select |
| G | `LI Status` | single-select |
| H | `Outreach` | **derived formula, read-only** |
| I | `Priority` | single-select 1–4 |
| J | `Notes` | free text |
| K..AG | the remaining 23 Atlas fields | Atlas fields |

### Vocabularies

- **Stage:** New, Contacted, Interested, Demo Booked, Trial Active, Closed-Won, Closed-Lost,
  Not Interested, DNC
- **Call Status:** No Answer, Voicemail, Answered, Interested, Not Interested, Callback,
  Wrong Number, DNC
- **SMS Status:** Sent, Delivered, Replied, Opted Out
- **FB Status:** Request Sent, Accepted, DM Sent, Replied, Ignored
- **IG Status:** Followed, DM Sent, Replied, Ignored
- **LI Status:** Request Sent, Accepted, InMail Sent, Replied, Ignored

### Outreach summary column

`H2` holds a single `ARRAYFORMULA` covering the whole column, so appended rows are populated
without Atlas writing anything into `H`:

```
=ARRAYFORMULA(IF(A2:A="","",REGEXREPLACE(
   IF(C2:C="","","Call: "&C2:C&" · ")&
   IF(D2:D="","","SMS: "&D2:D&" · ")&
   IF(E2:E="","","FB: "&E2:E&" · ")&
   IF(F2:F="","","IG: "&F2:F&" · ")&
   IF(G2:G="","","LI: "&G2:G&" · "),
   "( · )+$","")))
```

Renders as `Call: No Answer · FB: Replied`. Reps read one column and set five.

The exporter must **never write into column `H`** — doing so would overwrite the formula.
This is enforced by the header-mapping rule (`Outreach` matches no `Business` key) plus an
explicit guard in the writer.

### Colour coding

Four `CUSTOM_FORMULA` conditional-format rules spanning the whole channel block `C2:G1000`,
matched on outcome semantics rather than exact values:

| Colour | Matches |
|---|---|
| Green (positive) | Replied, Interested, Accepted, Answered |
| Amber (pending) | Sent, Request Sent, DM Sent, InMail Sent, Delivered, Followed, Callback |
| Red (negative) | Not Interested, Opted Out, DNC, Wrong Number, Ignored |
| Grey (neutral) | No Answer, Voicemail |

Rule form: `=MATCH(C2,{"Replied","Interested","Accepted","Answered"},0)`.

Four rules cover all five channels, and adding a sixth channel needs no new rules — only a
new column and a dropdown. Stage keeps its own 9 rules and Priority its 4, carried over from
the LexumSoft palette.

## Architecture

New module `server/src/sheets/`, four files with one responsibility each:

| File | Responsibility |
|---|---|
| `auth.ts` | JWT signing, token exchange, expiry-aware cache. |
| `client.ts` | REST wrapper on `fetch`: `listSpreadsheets`, `getTabs`, `appendValues`, `batchUpdate`. Retries 429/5xx with exponential backoff. |
| `sheetTemplate.ts` | **Single source of truth for look and feel** — headers, channel vocabularies, colours, widths, dropdowns, conditional-format rules, the summary formula. |
| `exporter.ts` | Orchestration: header mapping → dedup → batched append → summary. |

`sheetTemplate.ts` plays the same role for sheet styling that `selectors.ts` plays for the
Maps DOM: when the design or the channel vocabulary changes, exactly one file changes.

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

CRM headers (`Stage`, `Call Status`, `SMS Status`, `FB Status`, `IG Status`, `LI Status`,
`Outreach`, `Priority`, `Notes`) match no `Business` key and are left untouched.

**Name-collision hazard.** `Business` already has `facebook`, `instagram`, and `linkedin`
fields holding profile URLs, and matching is case-insensitive — so `Facebook` (channel
status) would collide with `facebook` (URL). This is resolved by giving the CRM columns
reserved names that cannot collide:

- `Call Status`, `SMS Status`, `FB Status`, `IG Status`, `LI Status`

The mapper additionally holds an explicit reserved-header set; any header in that set is
never treated as an Atlas field even if a name matches.

Appended rows are built at the full width of the header row. Cells for unmatched headers are
written empty, except `Stage`, seeded to `New`. Column `H` (`Outreach`) is always written as
empty string so the `ARRAYFORMULA` result is not disturbed.

### Styling of appended rows

No per-row formatting calls are needed. Data validation and conditional formats span rows
1–1000, and the summary `ARRAYFORMULA` covers the full column, so appended rows inherit
everything automatically.

## Migration of existing tabs

`Faizan` and `Amna` currently have `Status` / `Priority` / `Notes` at B/C/D. A one-off
migration script (not part of the app):

1. Rename `Status` -> `Stage`.
2. Insert the five channel columns and `Outreach` after it.
3. Map legacy values: `New` -> `New`; `Called-No Answer` -> `Stage: Contacted` +
   `Call Status: No Answer`; `Called-VM` -> `Contacted` + `Voicemail`;
   `Called-Interested` -> `Interested` + `Interested`; deal stages carry across unchanged.
4. Reapply the template (dropdowns, colour rules, widths).

In practice all 150 rows are currently `New`, so the value mapping is near-trivial — but it
is written and tested rather than assumed.

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

**Row cap.** Google caps a spreadsheet at 10M cells (~290k rows at 34 columns), and append
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

## Dashboard changes

The funnel now counts `Stage`, not the old `Status`:

- `CONTACTED` = rows where `Outreach <> ""` (any channel touched), replacing
  `COUNTIF(Status,"Called*")`, which stops being meaningful with five channels.
- Funnel stages count `Stage` directly.

New **CHANNEL PERFORMANCE** section, one row per channel: touched, replied, reply rate —
e.g. `COUNTIF(Faizan!C:C,"<>")` and `COUNTIF(Faizan!C:C,"Replied")`. This is the payoff of
the split model: it answers "which channel actually works" per rep.

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

Fix in `listingParser.ts` field extraction: strip the PUA range `[\ue000-\uf8ff]` and
collapse whitespace runs. This cleans the DB at source, so **both** CSV and Sheets output
benefit. A defensive strip also runs in the sheets writer. Regression test required.

### Credential hygiene

`n8n-chatbot.json` is an untracked live private key at the repo root that nothing ignores —
one `git add .` from being committed. Move to `server/.google-service-account.json` and add
both paths to `.gitignore`.

## Testing

Unit tests against a faked client, no live API calls:

- Header mapping: correct field→column resolution; all nine CRM columns preserved;
  unknown headers ignored; case-insensitive matching.
- **Reserved-header collision:** `FB Status` is not mapped to the `facebook` URL field, and
  `facebook` still maps correctly.
- `Stage` seeded to `New`; column `H` never written with a non-empty value.
- Dedup: placeId extracted from `mapsUrl`; duplicates skipped; fallback key when no
  `mapsUrl` column.
- Template: generates expected headers, the six dropdowns, the four channel colour rules,
  and the summary `ARRAYFORMULA`.
- Row cap rejection; retry/backoff on 429.
- Migration: legacy `Status` values map to the correct `Stage` + channel pair.
- `listingParser`: PUA glyphs stripped (regression).

Route tests via the existing `supertest` devDependency against a fake `deps.sheets`.

A live round-trip smoke test is gated behind `RUN_SHEETS_SMOKE=1`, mirroring the existing
`RUN_SMOKE` convention.

## Files touched

**New**
- `server/src/sheets/{auth,client,sheetTemplate,exporter}.ts`
- `server/test/sheets/{mapping,dedup,template,exporter,migration}.test.ts`
- `server/scripts/migrate-sheet.ts` — one-off tab migration
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
