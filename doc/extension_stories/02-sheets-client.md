# Story 02 — Sheets client, header mapping, vocabulary

**Ships:** the complete Google Sheets/Drive data layer — every network call any later story
needs, fully unit-tested.

> As a developer (and indirectly the user), the extension can list spreadsheets, list tabs, read
> rows, and update a single cell — with the same safety rules Atlas learned the hard way — so the
> UI stories only ever call typed methods.

## Scope

1. **`sheets/client.ts`** — port of Atlas `SheetsClient` (ARCHITECTURE §5.2), plain `fetch`:
   - Retry 3× exponential backoff (500ms base) on `429/500/502/503/504`; fail fast on `403/401`.
   - `listSpreadsheets()` (Drive files.list, spreadsheet mime, not trashed, modifiedTime desc).
   - `getTabs(id)` (sheetId, title, rowCount).
   - `getValues(id, range)`.
   - `updateCell(id, tabTitle, a1Cell, value)` — **single-cell** `values.update`,
     `valueInputOption=RAW`. There is no method that writes more than one cell and no
     `values:append` at all — make the dangerous thing unrepresentable (ARCHITECTURE §5.2 rules).
2. **`sheets/mapping.ts`** (ARCHITECTURE §5.3):
   - Header row → case-insensitive `Map<header, columnIndex>`.
   - `validateTab()`: requires `name`, `phone`, `Call Status`; returns the missing list for the
     picker's disabled-tab hint (UX S2).
   - Optional field pickup: ownerName, ownerTitle, category, address, website, rating,
     reviewCount, Stage, Notes.
   - Column index → A1 letters incl. beyond Z (Atlas tabs are 33 columns).
3. **`sheets/vocab.ts`**: `CALL_STATUS_VALUES` — the 8 values in sheet-dropdown order, with a
   comment binding it to `CHANNELS[0]` in Atlas `sheetTemplate.ts` (hand-kept in sync,
   ARCHITECTURE §2), plus the outcome→bucket mapping from DESIGN §2.4.

## Acceptance criteria

- [x] `client.test.ts` with injected fetch: retry matrix (each retryable status retries with
      backoff; 403 throws immediately); every write URL contains `valueInputOption=RAW`.
- [x] `mapping.test.ts`: reordered columns still resolve; missing `Call Status` reported by name;
      column 27+ produces `AA`+ letters; header match is case-insensitive.
- [x] `updateCell` builds ranges like `'My Leads'!C42` (tab titles with spaces/quotes escaped).
- [ ] Against a real Atlas-exported sheet (manual smoke): list, tabs, header mapping, and a
      single Call Status cell write that does **not** disturb the Outreach ARRAYFORMULA.
- [x] `vocab.ts` values match the screenshot/dropdown exactly:
      No Answer, Voicemail, Answered, Interested, Not Interested, Callback, Wrong Number, DNC.
<!-- needs manual smoke: the real-sheet round-trip (box 4) — exercised naturally by stories
     03/04/09 against a live Atlas export. -->

## Out of scope

Lead loading/pagination (story 04). Write queue (story 10). Any UI.
