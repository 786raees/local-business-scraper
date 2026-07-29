# Story 03 — Line type: pipeline integration & backfill

**Ships:** every newly scraped row arrives classified; existing databases catch up with one
command.

> As a user, I scrape as always and every row already has its line type; for last month's
> results I run one command and they get it too.

## Scope

1. **Scraper choke point**: in `server/src/scraper/mapsScraper.ts`, where the `Business` row
   is finalized after the phone is parsed, set
   `{ lineType, lineCarrier } = classifyPhone(b.phone)`. Rows without a phone get
   `'unknown'`/`''` explicitly. `ResultsStore` stays a dumb persistence layer — no
   classification in `insert` (composition-root discipline, ARCHITECTURE §1).
2. **`server/scripts/backfill-linetype.ts`** + `npm run linetype:backfill`:
   - Updates rows `WHERE lineType IS NULL OR lineType = ''`, classified from `phone`, in
     batched transactions (1000/batch); accepts an optional db-path arg defaulting to the
     server's `results.db`.
   - Idempotent (second run touches nothing) and safe alongside a running dev server
     (short transactions).
   - Prints a histogram: `classified N rows: a mobile · b landline · c voip · d unknown`.
3. Tests: finalize-time classification via the scraper's existing unit seams if practical,
   else a mini pipeline stub inserting through the store; backfill logic against an
   in-memory store (blank rows classified, populated rows untouched, second run no-op).

## Acceptance criteria

- [ ] A live smoke scrape (manual / `RUN_SMOKE=1`) produces non-empty `lineType` for US
      businesses.
- [x] Backfill on a fixture DB classifies all blank rows, prints the histogram, second run
      reports 0.
      <!-- unit-tested AND run against the real dev results.db:
           "classified 4 rows: 2 mobile · 1 landline · 1 voip", re-run "classified 0 rows".
           Field lesson folded in: the script self-migrates (ALTER TABLE) because a db never
           opened by the new ResultsStore lacks the columns -->
- [x] A row re-sighted by an overlapping tile keeps its classification (merge blank-fill).
      <!-- store-level merge test from story 02 covers the persistence half -->
- [x] No classification code inside `store.ts` (grep: classifyPhone appears only in
      mapsScraper.ts, backfill script, and its own module/tests).
- [x] `npm test` green in `server/` (246 tests).
<!-- needs manual smoke: box 1 — run a real US scrape (RUN_SMOKE=1 or via the UI) and confirm
     rows arrive with non-empty lineType. -->

## Out of scope

UI (04), exports (05).
