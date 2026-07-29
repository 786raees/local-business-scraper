# Story 02 — Line type: Business field & store

**Ships:** `lineType`/`lineCarrier` as first-class `Business` fields with storage, migration,
filtering, and sorting — via the complete add-a-field checklist (GMS_ARCHITECTURE §5).

> As a developer, a `Business` row carries its line type through SQLite and back out of a
> filtered, sorted query — and yesterday's database migrates itself on startup.

## Scope

1. **Types, both sides** (hand-kept in sync — ARCHITECTURE §1): `server/src/types.ts` and
   `web/src/lib/types.ts` gain `lineType: string` + `lineCarrier: string` on `Business`;
   `emptyBusiness()` initialises `''`; `ResultQuery` gains `lineType?: string`.
2. **`server/src/db/store.ts`** — every checklist item:
   - `COLUMNS` + `CREATE TABLE` (TEXT ×2) + the `added` migration list + `SORTABLE`
     (`lineType` only — carrier sorting is noise).
   - `whereClause`: `lineType` filter, exact equality — except `unknown` also matches `''`
     so legacy unbackfilled rows stay reachable:
     `(lineType = 'unknown' OR lineType = '')` when the filter value is `unknown`.
   - Verify (don't assume) that the merge path's CASE-WHEN blank-fill covers the new TEXT
     columns on duplicate re-sightings.
3. **`server/test/store.test.ts` additions**: startup migration adds both columns to a
   pre-feature schema (mirror the existing migration test pattern); insert/read round-trip;
   filter matrix (each type; `unknown` catches blank; composed with `hasPhone`); sort by
   `lineType` accepted, by `lineCarrier` rejected (allowlist injection guard).

## Acceptance criteria

- [x] A DB created before this story opens cleanly and gains both columns.
      <!-- migration test: legacy NULLs read back as '' and stay reachable via the
           unknown filter -->
- [x] `query({ lineType: 'mobile' })` returns only mobile rows; `unknown` returns
      unknown + blank; composes with existing filters.
- [x] `sortBy=lineType` orders; `sortBy=lineCarrier` falls back to id order.
- [x] `web/` type-checks with the synced `Business` (`npm run build` green in `web/`).
- [x] `npm test` green in `server/` (245 tests; +6 incl. merge blank-fill verification).

## Out of scope

Classifying anything (03), UI (04), exports (05).
