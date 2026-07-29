# Story 05 — Line type: exports & polish

**Ships:** the columns reach CSV and Google Sheets; docs and guardrails close the feature —
and hand it to the Quick Dial extension (extension story 13 consumes these headers).

> As a user, my exported CSV and my Sheets lead tabs carry `lineType` and `lineCarrier` — a
> mobile-filtered export becomes an SMS-ready list, and Quick Dial can show the type during
> calls.

## Scope

1. **CSV**: append `lineType`, `lineCarrier` to `ALL_COLUMNS` in `server/src/export/csv.ts`.
   Verify the streamed export honours the `lineType` filter param end-to-end.
2. **Sheets**: `TEMPLATE_HEADERS` derives from `ALL_COLUMNS`, so both columns join new tabs
   automatically at the end of the Atlas block. Verify:
   - No collision with `RESERVED_HEADERS`/CRM block; the Outreach `ARRAYFORMULA` untouched.
   - The template's positional column-width array covers only the first 10 columns —
     confirm nothing else indexes by position past it.
   - Close-out note: pre-existing tabs gain the columns only via
     `scripts/migrate-sheet.ts --restyle` (manual, user-run) — **required before extension
     story 13 can show line types on old tabs**.
3. **Docs**: add a `server/src/phone/` paragraph to `CLAUDE.md`'s architecture section
   (single source of truth in `lineType.ts`, committed snapshot, build/backfill scripts,
   the porting caveat) and move the feature from `GMS_PRD.md` §5 roadmap into §2/§3 as
   implemented.
4. **Polish sweep**: server test/build + web lint/build green; run
   `npm run linetype:backfill` on the dev DB and paste the histogram into the close-out.

## Acceptance criteria

- [x] Exported CSV of a mobile-filtered view contains only mobile rows and both new columns.
      <!-- FIELD FINDING: the CSV export was NOT filtered at all (iterateAll ignored the
           query; the route ignored req) — the "verify, don't assume" instruction earned its
           keep. Fixed end-to-end: iterateAll(batch, q) + route parseQuery + exportCsvUrl(q)
           + the table publishes its live query to the zustand store for the export link.
           Proven by store + route tests; live download is manual -->
- [ ] A fresh Sheets export to a new tab shows both columns after the existing Atlas
      fields; the Outreach column still computes.
- [x] Existing tabs untouched until `--restyle` (documented in GMS_UX F5 + CLAUDE.md).
- [x] CLAUDE.md + GMS_PRD.md updated (phone/ subsystem paragraph; 33→35 headers; roadmap →
      implemented; GMS_ARCHITECTURE §7b + GMS_UX F2/F5 refreshed).
- [x] All four package checks green (server: 249 tests + tsc; web: lint + build).
<!-- needs manual smoke: box 2 — export to a NEW Sheets tab and confirm lineType/lineCarrier
     appear after `location`, template applies, Outreach formula computes; plus a live
     filtered-CSV download from the UI. Backfill histogram (dev db, story 03):
     "classified 4 rows: 2 mobile · 1 landline · 1 voip". -->

## Out of scope (v2 backlog)

Paid per-number verification; automatic dataset refresh; carrier column in the UI table.
The extension-side display is **extension story 13** (`../extension_stories/13-line-type-display.md`).
