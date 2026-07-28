# Selective & Split Export — Design

**Date:** 2026-07-28
**Status:** Approved

## Problem

Export currently sends *all* stored rows to *one* tab. The team needs to (a) hand-pick rows
and send them to a specific rep tab (e.g. first 50 → Faizan, next 50 → Amna), and (b) split
an export across several tabs by percentage (Faizan 50%, Amna 40%, new tab 10%).

## Decisions

- Split applies to **whatever is being exported** — all rows or the current selection.
- Percentages must total **exactly 100%**; the Export button stays disabled otherwise, with
  a live total indicator.
- Rows are routed **sequentially** in export order: first ⌊total×p₁⌋ to target 1, next block
  to target 2, …; remainder rows go to the first target.
- Selection identity is `placeId`, so it survives paging, sorting, and filtering.
- Dedup stays per-tab: a row assigned to a tab that already contains it is skipped, not
  rerouted.

## Frontend

### Selection state (`web/src/lib/store.ts`)

```ts
selected: Set<string>            // placeIds
lastClicked: string | null
toggleSelect(placeId, shiftKey, visibleIds: string[]): void
setSelected(ids: string[], on: boolean): void
clearSelection(): void
```

Shift-click selects the contiguous range between `lastClicked` and the clicked row in
`visibleIds` — the currently displayed order (after sort/filter). Both rows in the range get
the *clicked checkbox's new state*. `clearSelection` runs on Clear data and after a
successful selected-scope export.

### ResultsTable

New leading checkbox column (not sortable): header checkbox toggles all rows of the current
filtered window (uses `visibleIds` from the loaded pages); row checkbox calls
`toggleSelect(placeId, e.shiftKey, visibleIds)`. Row count of selection shown in the TopBar
Export button: “Export (50 selected)”.

### ExportDialog

- **Scope step** (only when `selected.size > 0`): All rows (N) / Selected rows (M).
- **Destination step**: Single tab (existing flow) or **Split across tabs**.
- **Split step**: rows of `[tab picker | percent input]` + “add tab” + live total.
  Tab picker = existing tabs plus a “new tab…” name input per row. Export enabled only when
  total === 100 and every row has a tab. Duplicate tab targets are rejected.
- **Summary step**: per-tab `appended / skipped` list.

## API

`POST /api/export/sheets` body becomes:

```ts
{
  spreadsheetId: string
  targets: { sheetTitle: string; createNew?: boolean; percent: number }[]
  placeIds?: string[]          // absent = all rows
}
```

The old single-tab caller sends one target with `percent: 100`. Validation: ≥1 target,
percents sum to 100 (integer tolerance ±0), distinct sheetTitles, placeIds length ≤ 50k.
Response:

```ts
{ perTab: { sheetTitle: string; appended: number; skipped: number }[]; total: number }
```

Shared types (`ExportTarget`, `SplitExportResult`) added to **both** `server/src/types.ts`
and `web/src/lib/types.ts` (hand-synced).

## Exporter (`server/src/sheets/exporter.ts`)

New `exportSplit(deps, { spreadsheetId, targets, placeIds? })`:

1. Row-cap check on the scope size (selection size, else `count()`), before any write.
2. Compute per-target quotas: `floor(scopeTotal × percent/100)`, remainder to targets[0].
3. Stream `iterateAll(1000)`; skip rows not in the placeId set (Set lookup — only ids are
   held in memory, never rows). Route each surviving row to the current target until its
   quota is filled, then advance to the next target.
4. Per target, reuse the existing pipeline: resolve/create tab, build header map, dedup
   against that tab’s existing placeIds, buffer 5000-row RAW appends, reinstall the
   Outreach ARRAYFORMULA after the last append to that tab.
5. A quota of 0 rows still creates the tab when `createNew` is set.

The existing `exportToSheet` becomes a thin wrapper: one target at 100%.

## Testing

- Split math: rounding, remainder-to-first, 0-quota target, single target = old behaviour.
- placeId filtering: only selected rows exported; unknown ids silently absent.
- Per-tab dedup and per-tab summaries.
- Store: shift-range selection (forward, backward, re-anchoring, deselect ranges).
- Route: validation failures (percent ≠ 100, duplicate tabs, no targets).

## Files

- Modify: `web/src/lib/store.ts`, `store.test.ts`, `ResultsTable.tsx`, `TopBar.tsx`,
  `ExportDialog.tsx`, `web/src/lib/{types,api}.ts`
- Modify: `server/src/types.ts`, `server/src/api/routes.ts`, `server/src/index.ts`,
  `server/src/sheets/exporter.ts`, `server/test/sheets/exporter.test.ts`,
  `server/test/routes.test.ts`
