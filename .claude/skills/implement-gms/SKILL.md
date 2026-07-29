---
name: implement-gms
description: Implement a numbered GMS story for the Atlas Google Maps scraper (server/ + web/). Usage: /implement-gms <story-number> [extra instructions]. Reads the GMS_* docs in doc/, the matching story in doc/gms_stories/, implements it, then runs a final quality checklist against the acceptance criteria.
---

# /implement-gms — ship one Atlas story

The user invoked `/implement-gms $ARGUMENTS`. The first token is the story number (normalize
to two digits). Everything after it is extra instructions that **override or extend** the
story file — user instructions win over the docs on any conflict.

## Step 1 — Load context (always, in this order)

Read ALL of these before writing any code:

1. `CLAUDE.md` (repo root) — Atlas's condensed rule sheet. This is a mature codebase whose
   invariants were each learned by breaking something; they outrank anything you'd invent.
2. `doc/GMS_PRD.md` — the product and its stances.
3. `doc/GMS_ARCHITECTURE.md` — the narrative architecture: data flow, scaling rules, store
   checklist, scraper/sheets/geo invariants. The technical authority.
4. `doc/GMS_DESIGN.md` — the web UI system (Tailwind theme, `.field`/`.eyebrow`, status
   colours). New UI matches the existing app; never invent tokens.
5. `doc/GMS_UX.md` — the one-screen flows and error behaviour.
6. `doc/gms_stories/README.md` + `doc/gms_stories/<NN>-*.md` — the story index (with its
   dependency shape) and the target story.

Then read the existing source the story touches (e.g. `server/src/types.ts`,
`server/src/db/store.ts`, `server/src/scraper/*`, `server/src/api/routes.ts`,
`server/src/sheets/*`, `web/src/lib/store.ts`, the relevant components) — never re-invent or
re-scaffold what exists. If the story's dependencies aren't implemented yet, stop and say
which story must come first.

## Step 2 — Plan

Short plan from the story's **Scope** (files to create/modify, tests to write). Respect
**Out of scope** strictly — do not build ahead. Track with TaskCreate/TaskUpdate.

## Step 3 — Implement

Atlas hard rules (apply whichever the story touches):

- **Shared contract**: `server/src/types.ts` ↔ `web/src/lib/types.ts` hand-kept in sync —
  change both together or the WS/REST wire breaks.
- **Scaling**: rows persist as they arrive; WS broadcasts throttled counts only; the
  frontend holds a paginated window; CSV streams from the DB.
- **Store fields**: adding a `Business` field = types (both sides) + `COLUMNS` +
  `CREATE TABLE` + `added` migration list + `emptyBusiness` + `SORTABLE` (if sortable) +
  `ALL_COLUMNS` (CSV/Sheets). All of them, every time.
- **Scraper**: all Maps DOM selectors live only in `scraper/selectors.ts`; every Maps URL
  carries `hl=en&gl=us`.
- **Sheets**: scraped-data writes are `valueInputOption=RAW`; columns match by header name,
  never position; never disturb the Outreach `ARRAYFORMULA`; clear conditional-format rules
  before re-applying the template; respect `MAX_EXPORT_ROWS` before any write.
- **Routes** depend only on `RouteDeps` — keep them stub-testable.
- **Geo**: Nominatim via structured params only; cache lookups in the existing cache dirs.
- Match existing code style and comment density; tests follow the existing patterns
  (`:memory:` stores, injected fetch, `RUN_SMOKE=1` gating for live scrapes).

## Step 4 — Verify (mechanical)

Run and make pass:

```
cd server && npm test && npm run build
cd ../web && npm run lint && npm run build
```

(Skip the `web` pair only when nothing under `web/` changed — say so explicitly.) The gated
live-scrape smoke is NOT run automatically — list it as manual when relevant.

## Step 5 — Final quality checklist

Report each item ✅ / ❌ / N/A with one-line evidence pointing at a file/test/output. Do not
rubber-stamp.

1. **Acceptance criteria** — every `- [ ]` in the story demonstrably met; criteria needing a
   live scrape / real Google account → N/A + listed for the user's manual smoke.
2. **Scope complete, nothing extra** — no out-of-scope leakage.
3. **Doc conformance** — spot-check against the exact GMS doc sections the story cites.
4. **Hard rules** — verify the applicable Step-3 invariants: diff the two `Business`
   interfaces; store checklist complete; grep for `USER_ENTERED`/`values:append` misuse;
   selectors confined; no unapproved new runtime dependencies.
5. **Tests** — the story's named tests exist, assert behaviour, pass, and hit no network.
6. **Build health** — the Step-4 commands green.
7. **Regression** — the full existing `server` suite still passes; nothing previously
   working broke.
8. **TypeScript strictness** — no `any` escapes, no suppressions without a stated reason.

Fix any ❌ and re-run before finishing.

## Step 6 — Close out

- Tick satisfied `- [ ]` boxes in the story file; leave unverifiable ones with a
  `<!-- needs manual smoke: ... -->` note.
- Final message: what shipped, checklist table, manual-smoke steps, next story per the
  README.
- Do not commit unless the user asks.
