# Story 06 — Scrape throughput: stop paying full price for duplicates

**Ships:** a segmented job with enrichment on runs several times faster — known places are
skipped *before* their detail page is opened, website enrichment runs in a small concurrent
pool (static fetch first, browser fallback) instead of serially inside the Maps loop, and
one browser serves the whole job instead of one per tile.

> As a lead-gen operator running a tiled city scrape with social links on, I get my unique
> rows in minutes instead of hours — the scraper spends its time on businesses I don't have
> yet, not on re-visiting the ~80% of feed entries that overlapping tiles repeat.

## Dependency

Needs the segmented pipeline (grid/searchUrl/mapsScraper — shipped pre-stories) and the
`ResultsStore` placeId upsert (shipped). Independent of stories 00–05 (line type). No UI
or `web/` changes beyond the shared-types edit.

## Why it is slow today (measured against the code, binds nothing)

Dedup happens only at `ResultsStore.insert` — *after* the detail page was scraped and the
website enrichment ran. With ~80% tile overlap, ~80% of Playwright time is spent
re-scraping stored places. On top: `scrapeMaps` launches a fresh Chromium per task (= per
tile), `scrapeWebsite` loads up to 9 pages × 12s timeout serially between detail visits,
and `scrollFeed` sleeps a fixed 1500ms per scroll round.

## Design decisions (bind the implementation)

1. **Dedup before navigation, on the feed href.** `placeIdFromUrl` already parses the
   `!19s` segment from the hrefs `scrollFeed` collects — no navigation needed. `scrapeMaps`
   gains an injected `isKnown(placeId: string) => boolean` and filters the URL list before
   the detail loop. **A URL whose placeId cannot be parsed is always visited** — dropping
   unidentifiable results would silently lose real businesses; the store already keeps
   NULL placeIds distinct for the same reason. Prevents: the 5× duplicate tax.
2. **`isKnown` asks the store, nothing else.** New `ResultsStore.hasPlaceId(id)` (prepared
   `SELECT 1 … WHERE placeId = ?`), wired in `index.ts` next to the existing
   `() => inserted` meter. No in-memory seen-set duplicating the store — two sources of
   truth is how the count and the DB drift apart. Rows land in SQLite before the next tile
   starts (inserts are synchronous in `handleEvent`), so the store is always current.
3. **One browser per job, not per task.** The browser/context moves out of `scrapeMaps`
   into `JobRunner.run` (created once, closed in `finally`, passed through `ScrapeFn`).
   Consent is dismissed once per context. Prevents: N tiles × (cold start + consent) —
   pure overhead at 100+ tiles. Abort still closes the browser via the same `finally`.
4. **Enrichment is a concurrent pool, decoupled from the Maps loop.** The Maps loop emits
   the row with GMB data immediately (budget counts it, the user sees it) and queues
   enrichment; a pool of at most **3** workers processes the queue while the Maps loop
   keeps harvesting. When enrichment lands, the row is re-emitted as an **update** and the
   store's blank-fill merge does the rest. `job-done` fires only after the pool drains;
   abort cancels queued work and in-flight pages via the existing `AbortSignal`.
   Politeness stance is preserved: concurrency applies to *distinct third-party sites* —
   navigation against google.com stays strictly serial with randomized delays.
5. **Update events must not pollute the duplicate counter.** `JobEvent`'s `row` variant
   gains `update?: true` (both `types.ts` files — the hand-synced pair). `handleEvent`
   routes updates straight to `store.insert` (merge) without touching `inserted` *or*
   `duplicates`. Without this, every enriched row would show up as a "duplicate" in the
   TopBar and the dedup metric becomes noise.
6. **Static fetch first, browser only as fallback.** `scrapeWebsite` tries a plain
   `fetch` of each path (same UA, ~8s timeout) and runs the existing extractors
   (`extractAllEmailsFromHtml`, `extractSocials`, `extractOwner`) on the raw HTML; the
   Playwright page is opened only when fetch fails or yields no signal on any path. Most
   small-business sites surface email/socials in static HTML — a fetch is ~50ms against
   seconds per rendered page. The stop-early conditions (`haveEmail`/`haveSocial`/
   `ownerDone`) are shared by both modes.
7. **Waits shrink where nothing is happening.** `scrollFeed` polls for a feed item-count
   change (~250ms interval, 1500ms cap per round) instead of an unconditional 1500ms
   sleep; the politeness `delay(delayMinMs, delayMaxMs)` applies only after an *actual*
   detail navigation — skipped known URLs cost zero. A tile whose collected URLs are
   **all** already known stops scrolling after two all-known rounds (`stagnantKnown`)
   instead of grinding to `maxResults`.

## Scope

1. **Store** (`server/src/db/store.ts`): `hasPlaceId(placeId: string): boolean` — prepared
   statement; blank/NULL ids return false. Tests in `test/store.test.ts` (insert → true;
   unknown → false; `''` → false).
2. **Maps loop** (`server/src/scraper/mapsScraper.ts`): accept the shared
   `BrowserContext` + `isKnown`; extract a pure `partitionUrls(urls, isKnown)` helper
   (returns `{ fresh, known }`, unparseable → fresh) so decision 1 is unit-testable
   without Playwright; early-stop in `scrollFeed` per decision 7; delay only after real
   navigations.
3. **Runner** (`server/src/queue/jobRunner.ts` + `server/src/index.ts`): browser lifecycle
   per decision 3; `ScrapeFn` signature extended; wire `isKnown` to `store.hasPlaceId`.
   Runner tests keep working through the injected fake `ScrapeFn` (no Playwright in
   tests) — extend them for the browser-factory injection.
4. **Enrichment pool** (new `server/src/scraper/enrichPool.ts` + edits in
   `mapsScraper.ts`): bounded queue, 3 workers, drain-before-done, abort-aware. Pure
   scheduling logic (enqueue/drain/cancel ordering) unit-tested with fake async tasks in
   `test/enrichPool.test.ts`.
5. **Static-first site scrape** (`server/src/scraper/siteScraper.ts`): fetch path per
   decision 6 with injected `fetch` (existing test convention — no network in tests);
   fixture-HTML tests in `test/siteScraper.test.ts` for: static hit skips the browser,
   empty static falls back, stop-early honoured.
6. **Wire + shared contract**: `JobEvent` `row.update?` in **both** `server/src/types.ts`
   and `web/src/lib/types.ts` (change together — the hand-synced pair); `handleEvent` in
   `index.ts` per decision 5. `web/` needs no behavioural change (`applyEvent` already
   ignores fields it doesn't read — verify, don't assume).
7. **Docs**: refresh `CLAUDE.md` scraper paragraph + `GMS_ARCHITECTURE.md` §4 (pool,
   static-first, per-job browser) and §3 (pre-navigation dedup joins the tile-overlap
   rule).

## Out of scope

- Parallel Maps tabs (multiple tiles scraped concurrently) — google.com navigation stays
  serial; that's the polite-scraper stance, not a missing feature.
- Grid restructuring / overlap reduction at the source — pre-navigation dedup makes
  overlap cheap; changing tile geometry risks the coverage rules (`kmPerDegLng`, coarsen-
  never-truncate) for marginal gain.
- Proxy support, scheduled re-scrapes, headful debugging niceties (PRD §5 backlog).
- Any UI change; any new `Business` field; any Sheets/export change.

## Acceptance criteria

- [x] A known placeId in the feed is skipped without a detail navigation; an unparseable
      href is still visited (`partitionUrls` unit tests; store `hasPlaceId` tests).
- [x] One browser serves a multi-task job: runner tests prove the factory is invoked once
      per `run()` and closed on completion *and* on abort
      (jobRunner.test.ts "JobRunner lifecycle" describe; `createMapsSession` + lifecycle
      hooks wired in index.ts).
- [x] Enrichment runs off the Maps loop: `enrichPool` tests prove ≤3 concurrent workers,
      drain-before-done, and abort cancels queued work (test/enrichPool.test.ts, 6 tests).
- [x] Enrichment updates re-emit with `update: true` and increment neither `inserted` nor
      `duplicates` (store-backed contract test in store.test.ts + runner-level budget test
      in jobRunner.test.ts).
- [x] Static-first: fixture test shows a site whose HTML contains the email/socials never
      opens a Playwright page (exploding context stub); an empty static response falls
      back to the browser path (test/siteScraper.test.ts, 8 tests).
- [x] `scrollFeed` no longer hard-sleeps 1500ms per round (`waitForFeedGrowth` polls at
      250ms, 1500ms cap) and an all-known tile stops early
      (`advanceFeedProgress`/`feedExhausted` unit tests in mapsScraper.test.ts).
- [x] Shared contract intact: the `JobEvent` diff appears in both `types.ts` files
      (`git diff` shows the pair changing together).
- [ ] Live segmented smoke (`RUN_SMOKE=1`, manual): re-running a completed job's tile set
      produces near-zero detail navigations and finishes in a fraction of the first run.
      <!-- needs manual smoke: run a segmented job with enrichment on, note wall-clock;
           without clearing the DB is not possible via the UI (start clears) — instead
           compare a first run's duplicate count/time against pre-story behaviour, and
           watch rows appear instantly with socials filling in moments later -->
- [x] Full checks green: `cd server && npm test && npm run build` (276 tests + tsc);
      `cd web && npm run lint && npm run build` (lint warnings pre-existing in
      LocationSelector.tsx only); prior suites unbroken.
