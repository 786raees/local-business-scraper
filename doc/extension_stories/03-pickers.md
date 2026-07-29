# Story 03 — Spreadsheet & tab pickers (S1, S2)

**Ships:** the user can browse to their lead tab inside the panel.

> As a user, I open the panel, search my spreadsheets, pick one, see its tabs (with bad tabs
> explained, not hidden), and select my lead tab — so the extension knows where my leads live.

## Scope

1. **S1 — Pick spreadsheet** (UX S1, DESIGN §6.5/§6.6):
   - Autofocused search input, client-side filtering; `/` focuses search.
   - List rows: name + "modified X ago", 44px, hover/selected states per DESIGN.
   - Previously used spreadsheet pinned under a "Recent" caption.
   - Empty state = fix-it screen: "No spreadsheets shared with <email>" + copy-chip + Refresh.
2. **S2 — Pick tab** (UX S2):
   - Header `‹ back · <spreadsheet name>`.
   - Tab rows: title + row count. Invalid tabs (mapping.validateTab fails) rendered disabled with
     "missing: <headers>" caption.
   - Selecting a valid tab stores the selection and hands off to lead loading (story 04 shows
     "Reading N leads…"; until then, a stub confirmation is fine).
3. **Background as data owner**: panel sends `sheets/listSpreadsheets` / `sheets/listTabs`
   messages; all fetching happens in the worker (ARCHITECTURE §1, §4). Loading and error states
   for both lists (spinner row; error banner with Retry).
4. **Selection persistence**: chosen spreadsheet/tab remembered in `storage.local`; on later
   panel opens with a remembered selection, S1/S2 are skipped (UX §1 — "returning user goes
   toolbar icon → S3 in one click"). The `⇄` change-list icon routes back to S1.

## Acceptance criteria

- [ ] With ≥2 shared spreadsheets: search filters as typed; selection opens S2; back returns.
- [ ] A non-Atlas tab appears disabled with the exact missing header names.
- [ ] 403 on listing renders the not-shared fix-it state with the copy-email chip (UX §4.1).
- [ ] After a full selection, closing and reopening the panel skips straight past S1/S2.
- [x] All list/row/input styling uses tokens; keyboard: arrows move rows, Enter selects.
<!-- needs manual smoke: boxes 1–4 are live-UI behaviours against a real Drive account —
     the underlying logic (validateTab missing-list, 403 Result.status, selection skip
     routing) is implemented and the pure parts unit-tested; verify visually per the
     /implement 03 report. Box 5's token rule is grep-verified; keyboard nav implemented
     (arrows move row focus, Enter activates the focused button natively). -->

## Out of scope

Reading lead rows (story 04). Session home (story 05).
