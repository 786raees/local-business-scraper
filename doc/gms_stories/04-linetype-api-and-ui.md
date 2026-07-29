# Story 04 — Line type: API & web UI

**Ships:** the "mobile only" experience — filter select + Line chip column in the Atlas app.

> As a user, I pick `Line: Mobile` in the toolbar and the table, count, and pagination show
> only mobile rows; each row wears a chip telling me its type at a glance.

## Scope

1. **API passthrough**: `server/src/api/routes.ts` parses `lineType` from the query string
   into `ResultQuery` for `GET /api/results` — same style as the existing params
   (unrecognized values → no filter). CSV export flows through the same `ResultQuery`, so a
   filtered export needs only the param.
2. **Web state**: the Zustand filter object (`web/src/lib/store.ts`) gains
   `lineType: string` (`''` = All); verify `useResults` serializes it to the wire; changing
   it resets pagination like every other filter.
3. **Filter select** (GMS_DESIGN §4/§5): compact select in the existing filter bar beside
   the has-phone/has-email controls, using `.field` styling —
   `Line: All / Mobile / Landline / VoIP / Unknown`, `aria-label="Filter by line type"`.
4. **Table column** (GMS_DESIGN §1/§4 status-colour rules): a narrow sortable `Line` column
   rendering a chip — Mobile (`teal`), Landline (`muted`), VoIP (`amber`), muted `—` for
   unknown/blank — text labels always, theme tokens only. Tooltip:
   `"{lineCarrier} — based on the number's original carrier assignment; ported numbers may
   differ."` (carrier part omitted when empty — the porting caveat ships on every chip).
5. Tests: route param parsing with a stubbed `RouteDeps` store asserting the query object;
   `web` store test additions if the existing pattern covers filters
   (`npx vitest run src/lib/store.test.ts` stays green).

## Acceptance criteria

- [x] `GET /api/results?lineType=mobile` returns only mobile rows + matching count (stub test).
      <!-- routes.test.ts: valid value reaches the store query; 'carrier-pigeon' → undefined -->
- [ ] UI select filters table + count, composes with search/rating, resets pagination.
- [ ] Chips render all four states with text labels + the caveat tooltip; no ad-hoc colours.
- [x] `Line` column sorts; `unknown` filter surfaces legacy blank rows.
      <!-- SORTABLE + unknown-matches-blank proven at store level (story 02); the column
           header wiring reuses the existing toggleSort path -->
- [x] server test/build + web lint/build all green (247 tests; 3 pre-existing lint warnings
      in LocationSelector untouched).
<!-- needs manual smoke: boxes 2–3 are visual — open the app, set Line: Mobile, verify table
     + count + composition with other filters, and hover a chip for the carrier caveat
     tooltip. Chip colours use theme tokens (teal/amber/muted) only. -->

## Out of scope

CSV/Sheets columns (05).
