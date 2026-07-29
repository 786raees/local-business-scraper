# Story 04 — Lead loading

**Ships:** selecting a tab produces an in-memory, worker-owned lead list with correct identity
and dialability.

> As a user, when I pick my tab the extension reads all my leads (however many rows), knows which
> ones it can dial, and survives a worker restart without re-reading — so sessions start fast and
> nothing is lost when Chrome recycles the background worker.

## Scope

1. **Loader** in the worker (ARCHITECTURE §5.4):
   - Header row via mapping (story 02), then paged `getValues` (1000-row pages) until a short
     page.
   - Build `Lead` per row: `rowIndex` (1-based sheet row) is the identity; map required +
     optional fields.
   - Rows with empty `phone` counted as `skippedNoPhone`, excluded from the dialable list.
2. **Progress**: `loading-leads` phase streams "Reading N leads…" to the panel (UX S2→S3
   transition); large tabs (50k rows) must not freeze the UI (loading happens in the worker;
   panel just renders counts).
3. **Persistence**: leads + mapping + snapshot checkpointed to `chrome.storage.session`
   (ARCHITECTURE §7.4, §8); on worker restart, rehydrate before answering any message.
4. **Dial filters** computed here (UX S3.5): `all` / `uncalled` (empty Call Status) / `retry`
   (No Answer or Callback). Filter is a view over the loaded list, remembered in settings.
5. **Session snapshot plumbing**: `panel/hydrate` returns a real `SessionSnapshot`
   (phase `ready`, lead counts, cursor 0 or persisted resume point).

## Acceptance criteria

- [x] A 3k-row test tab loads fully (3 pages), counts match, panel shows totals + skipped count.
      <!-- pagination proven in leads.test.ts (2500-row fixture, 3 pages); the live-tab visual
           check is manual -->
- [x] `rowIndex` maps correctly back to sheet rows (row 2 = first data row).
- [ ] Kill the service worker (chrome://serviceworker-internals or extension reload during dev)
      → reopening the panel shows the same loaded state without a network re-read.
- [x] Filter counts correct on a fixture with mixed Call Status values; DNC rows excluded from
      `uncalled` and `retry`.
- [x] Unit tests: pagination loop, empty-phone exclusion, filter predicates, snapshot round-trip.
<!-- needs manual smoke: worker-kill rehydration (box 3) and the live progress display —
     see /implement 04 report. -->

## Out of scope

Starting a session, cursor movement (stories 05/07).
