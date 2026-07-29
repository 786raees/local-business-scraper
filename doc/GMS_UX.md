# UX — Atlas (Google Maps Scraper)

**Status:** Living document — describes the flows as implemented
**Companion docs:** `GMS_PRD.md` · `GMS_ARCHITECTURE.md` · `GMS_DESIGN.md`

One screen, two zones: **build the job on the left, watch and work the results on the
right.** There is no navigation; every flow happens in place.

---

## 1. Screen map

```
┌─────────────────────────── TopBar ───────────────────────────┐
│ title · live result counter · Start/Stop · Export · Clear    │
├───────────────┬──────────────────────────────────────────────┤
│ Keywords      │ QueuePanel (tasks: queued/running/done/error) │
│ Location      ├──────────────────────────────────────────────┤
│  pickers      │ ResultsTable                                  │
│ Location list │  filters row · virtualized rows · selection   │
│ Settings      │                                               │
└───────────────┴──────────────────────────────────────────────┘
```

## 2. Flows

### F1 — Build a job (left sidebar, top to bottom)

1. **Keywords** — add any number ("dentist", "roofing contractor"). Chip list, removable.
2. **Location** — cascading pickers: country → state (only subdivisions that actually have
   cities) → city → optional zip codes (fetched live from Zippopotam). Add as many
   locations as needed; each shows as a labelled row in the location list.
3. **Settings** — max results (whole-job budget of *unique* rows), email extraction toggle,
   owner-finder toggle, headless toggle, min/max delay, **segmentation** (on/off + tile km +
   max tiles). Settings are clamped server-side; an inverted delay range is reordered, not
   rejected.

### F2 — Run

- **Start** expands keywords × locations into tasks (× tiles when segmented — labels like
  "dentist — London (3/108)") and runs them sequentially with randomized delays.
- The **QueuePanel** shows each task's status chip live; the TopBar counter ticks up as
  *unique* rows land (duplicates across overlapping tiles don't count).
- **Stop** aborts cleanly mid-task. Reaching the max-results budget stops the run with
  remaining tiles unvisited.
- Starting a new job clears previous results (the DB is per-run working storage; export
  what you want to keep first).

### F3 — Review results

- Rows stream into the virtualized table as scraped; the window is server-paginated so any
  result count stays smooth.
- **Filters:** free-text (name/address/category/phone/email), category, min rating, min
  reviews, has-email / has-website / has-phone, and **Line type**
  (All/Mobile/Landline/VoIP/Unknown — Unknown includes unbackfilled rows). **Sort** by the
  allowlisted columns. Filters combine; the count reflects the filtered set. The `Line`
  column's chip tooltip carries the carrier + porting caveat.
- **Selection:** click + shift-click ranges, feeding split export.

### F4 — Export

- **CSV** — streams the *current filtered view*; unlimited size.
- **Google Sheets** (ExportDialog):
  1. Pick a spreadsheet (only those shared with the service account are listed — the dialog
     surfaces the account email to copy) → pick or create tab(s).
  2. Optionally **split across tabs by percent** (integers summing to 100), deduped against
     all target tabs; optionally scoped to selected rows.
  3. New tabs get the full CRM template (Stage/channel dropdowns, colours, Outreach
     formula); existing tabs keep their layout — Atlas matches columns by header name.
  4. Exports over 50k rows are refused before any write (use CSV).
- **CSV import** — bring existing leads into the DB with a normalised fallback identity so
  they dedup against scraped rows.

### F5 — Recovery / maintenance (scripts, manual)

- `npm run linetype:backfill` — classify pre-feature rows (idempotent, prints a histogram).
- `npm run linetype:build` — regenerate the NPA-NXX snapshot (maintainer-only, rare).
- `scripts/migrate-sheet.ts --restyle` — reapply the sheet template safely (also how
  pre-feature tabs gain the `lineType`/`lineCarrier` columns).
- `scripts/repair-formula-errors.ts` — recover `#ERROR!` cells caused by USER_ENTERED.
- Cross-tab duplicate removal one-off script.

## 3. Feedback & error behaviour

| Situation | Behaviour |
|---|---|
| Google markup changed / 0 rows | task errors visibly in the queue; fix is `selectors.ts` |
| Rate-limited / blocked | task marked `blocked`; delays between tasks are the mitigation |
| Nominatim/Zippopotam hiccups | geo lookups are cached (`.geo-cache/`); zip step is optional |
| Sheets not shared | export dialog shows the service-account email to share with |
| Export > 50k rows | refused up front with the CSV suggestion — never a half-written sheet |
| Duplicate sightings | merged silently; the counter only counts new rows |

## 4. Conventions for new UX

- Everything stays on the one screen; prefer inline panels/dialogs over routes.
- Long operations must stream progress (WS events) — no spinners hiding minutes of work.
- Filters must round-trip through `ResultQuery` so CSV export always matches what the user
  sees.
- Destructive actions (Clear) and irreversible external writes (Sheets) confirm or
  hard-cap; scraped data is precious once enriched.
