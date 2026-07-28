# Selective & Split Export Implementation Plan

> **For agentic workers:** execute task-by-task with tests before implementation where practical.

**Goal:** Row selection with shift-range in the results table, and export of the chosen scope to one tab or split across multiple tabs by percentage.

**Architecture:** Selection lives in the Zustand store keyed by `placeId`; a new `/api/results/ids` endpoint supplies display-order ids so shift-ranges work across unloaded virtual rows. The exporter gains `exportSplit`, which streams rows, filters by placeId set, and routes sequential quota blocks to each target via the existing per-tab pipeline.

## Global Constraints

- All writes of scraped data remain `RAW` (updateValues defaults to RAW; only ARRAYFORMULA install uses USER_ENTERED).
- Never accumulate rows in memory — stream `iterateAll(1000)`; only id Sets are held.
- Shared types added identically to `server/src/types.ts` and `web/src/lib/types.ts`.
- Percentages must total exactly 100; remainder rows go to targets[0]; routing is sequential.
- Per-tab dedup: assigned duplicates are skipped, not rerouted.

## Tasks

### Task 1: Server — id listing + split exporter
- `ResultsStore.queryIds(offset, limit, q)` → `string[]` of placeIds in the same order as `queryPage` (reuses where/order clauses).
- `GET /api/results/ids?offset&limit&<filters>` → `string[]` (limit ≤ 50000).
- Types: `ExportTarget { sheetTitle; createNew?; percent }`, `TabExportSummary { sheetTitle; appended; skipped }`, `SplitExportResult { perTab: TabExportSummary[]; total }` in both types files.
- `exportSplit(deps, { spreadsheetId, targets, placeIds? })` in `exporter.ts`:
  - cap check on scope size before any write (413)
  - quotas: `floor(scope × pct/100)`, remainder to first target
  - stream + filter by placeId Set, fill quota blocks sequentially
  - per target: reuse tab resolve/create, header map, per-tab dedup, 5000-row RAW appends, Outreach formula reinstall (only for touched/created tabs)
  - `exportToSheet` becomes a wrapper: one target at 100%.
- Route: `POST /api/export/sheets` accepts `{ spreadsheetId, targets, placeIds? }`; validates targets non-empty, distinct titles, percents integers summing to 100. Returns `SplitExportResult`.
- Tests: split math (rounding/remainder/zero-quota), placeId filter, per-tab summaries, route validation, ids endpoint.

### Task 2: Frontend — selection state + table checkboxes
- Store: `selected: Set<string>`, `lastClickedIndex: number | null`, `setSelected(ids, on)`, `toggleOne(placeId, index)`, `clearSelection()`.
- `api.getResultIds(offset, limit, query)`.
- ResultsTable: leading 36px checkbox column; row checkbox onClick handles `e.shiftKey`:
  - no shift → toggleOne
  - shift + anchor → fetch ids for `[min(anchor,idx), max(anchor,idx)]` via getResultIds with current query, `setSelected(range, checked)`
  - header checkbox: fetch all ids for current query → select/clear all; shows indeterminate when partial.
- TopBar Export button label shows `(N selected)`. `clearSelection` on Clear data.
- Store tests for selection logic.

### Task 3: Frontend — dialog scope + split UI
- Scope step when selection exists: All (total) / Selected (N).
- Destination: Single tab (existing) or Split across tabs.
- Split editor: rows of tab-picker (existing tabs or new-name input) + integer percent; add/remove rows; live total; Export disabled unless total === 100, all rows have distinct tabs.
- Calls `api.exportToSheet({ spreadsheetId, targets, placeIds? })`; summary step lists per-tab appended/skipped. Clear selection after successful selected-scope export.
- Typecheck + lint + live verification against the real sheet.
