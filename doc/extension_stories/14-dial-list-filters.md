# Story 14 — Dial-list filters: call exactly who you mean to

**Ships:** the single `DialFilter` dropdown grows into a composable filter set — line type,
website presence, review count, rating, stage/outcome — so a caller can run a session over
"mobiles with no website and fewer than 20 reviews" without exporting a new tab from Atlas.

> As a caller, before pressing Start I can tick a few criteria (only mobile numbers, no
> website, reviews < 20, …) and the session dials only leads that match — the lead counter,
> start-from picker, and progress bar all reflect the filtered list.

## Dependency

Needs stories 05 (session home + filter), 07 (state machine over the dialable list),
12 (picker), and 13 (line-type columns in `Lead`). All shipped.

## Design decisions (bind the implementation)

1. **The filter is one plain object, evaluated in one place.** Extend
   `shared/types.ts`:

   ```ts
   export interface DialCriteria {
     status: 'all' | 'uncalled' | 'retry'          // today's DialFilter, renamed field
     lineTypes?: Array<'mobile' | 'landline' | 'voip' | 'unknown'>  // absent = any
     website?: 'any' | 'has' | 'none'
     reviewCount?: { op: 'lt' | 'gte'; value: number }
     rating?: { op: 'lt' | 'gte'; value: number }   // 1.0–5.0, one decimal
     stages?: string[]                              // sheet Stage values, absent = any
     outcomes?: CallOutcome[]                       // only meaningful with status 'all'/'retry'
   }
   ```

   `matchesFilter(lead, criteria)` in `background/leads.ts` remains the single evaluator —
   the state machine, picker, counters, and "filtered out" explainer all go through
   `dialableLeads`. No component ever filters on its own.
2. **`DialFilter` stays as the status axis.** `'all' | 'uncalled' | 'retry'` becomes
   `criteria.status`; a migration in `shared/storage.ts` lifts a stored legacy `dialFilter`
   string into `{ status: dialFilter }` so existing users keep their setting.
3. **Missing data never silently excludes.** A lead with a blank `reviewCount`, `rating`,
   or `lineType` fails a numeric/line filter only when the filter is active, and the home
   screen shows how many leads were excluded for *blank* values ("12 leads have no rating
   and are excluded") — a caller must be able to tell "filtered" from "sheet has no data".
   `unknown` in `lineTypes` explicitly matches blank/absent line types (mirrors Atlas's
   store filter semantics).
4. **Sheet-derived vocabularies, not hardcoded ones.** The Stage and Outcome checkbox lists
   are built from the distinct values actually present in the loaded tab (plus the
   canonical vocab), so CRM-customised sheets still filter correctly. Line-type options are
   the fixed four.
5. **Numbers parse defensively.** `reviewCount`/`rating` cells are strings from Sheets —
   parse with `Number(...)`; `NaN` counts as blank (rule 3), never as `0`.

## Scope

1. **Types + evaluator** (`shared/types.ts`, `background/leads.ts`): `DialCriteria`,
   `matchesFilter` rewrite, `dialableLeads`, blank-value exclusion counts
   (`excludedBlankCounts(leads, criteria)` for rule 3's caption).
2. **Persistence + migration** (`shared/storage.ts`): `settings.dialCriteria` replaces
   `dialFilter` (legacy value migrated per decision 2); session snapshot carries the
   criteria so a worker restart resumes the same filtered list.
3. **Messages + worker** (`shared/messages.ts`, `background/index.ts`):
   `session/setCriteria` replaces `session/setFilter`; changing criteria mid-session
   re-anchors the cursor via the existing `reanchorCursor` (same mechanism as the
   pause/resume fix — the current lead must not be skipped or repeated).
4. **Filter UI on the home screen (S3)** (`sidepanel/components/`): a collapsed one-line
   summary ("Uncalled · Mobile · No website · Reviews < 20") with the matching-lead count,
   expanding to a compact panel: status radio (existing three), line-type chip toggles
   (reusing `LineChip` styling), website tri-state, review/rating rows (op select + number
   input), stage/outcome checklists. "Reset" returns to `{ status: 'uncalled' }`.
   Everything keyboard-reachable; counts update live as criteria change.
5. **Options page** (`options/SettingsSection.tsx`): the dial-filter select becomes a
   read-only summary + "edit in side panel" hint (one editor, no drift), while still
   letting the status axis be set as the default for new sessions.
6. **Picker + explainer** (story 12 components): the zero-match explainer names *which*
   criterion excluded the searched lead ("Acme is filtered out — landline, filter requires
   mobile"), extending the existing `leads/searchAll` response.
7. **Tests** (`test/leads.test.ts` + new `test/criteria.test.ts`): every axis alone and
   combined; blank-value semantics per decision 3; `unknown` matching blank; NaN handling;
   storage migration from legacy `dialFilter`; mid-session criteria change re-anchoring;
   picker explainer naming the failing criterion.

## Out of scope

- Writing anything to the sheet (filters are read-side only).
- Free-text/notes search as a filter (the picker's search already covers finding one lead).
- Saved filter presets and per-tab remembered filters (v2 candidate).
- Atlas-side changes — the web app's filter/export already exists (gms 05).
- Sorting the dial order (list stays in sheet-row order).

## Acceptance criteria

- [x] Each axis filters correctly on its own and combined (AND semantics across axes,
      OR within a multi-select axis), proven by `criteria.test.ts`.
- [x] Blank `rating`/`reviewCount`/`lineType` handling matches decision 3, including the
      excluded-for-blank caption and `unknown` matching blanks.
      <!-- excludedBlankCounts tests + buildSnapshot excludedBlank test; caption rendered in
           DialFilterPanel "Excluded for blank data: …" -->
- [x] Existing users' stored `dialFilter` migrates to `dialCriteria` (test on the storage
      migration; no user-visible reset).
      <!-- normalizeStoredSettings tests: legacy lift, stored-criteria-wins, default -->
- [x] Changing criteria mid-session never skips or repeats the current lead
      (`reanchorCursor` regression test extended to criteria changes).
      <!-- session/setCriteria handler re-anchors + saves resume; criteria.test.ts final describe -->
- [ ] Home screen shows the collapsed summary + live matching count; panel is fully
      keyboard-operable; chip/toggle colours come from tokens only (no raw hex).
      <!-- code + grep verified (tokens/color-mix only); visual + keyboard walkthrough
           needs manual smoke in the loaded panel -->
- [x] Picker zero-match explainer names the specific failing criterion.
      <!-- explainExclusion tests; leads/searchAll returns {name, reason};
           StartFromPicker renders it -->
- [x] Stage/Outcome options include values actually present in the tab.
      <!-- tabVocab test: sheet stages sorted, canonical outcomes + CRM extras -->
- [x] Full suite green (`npm run build && npm test && npm run lint` in `extension/`);
      prior stories' tests untouched or updated with cause (leads/state/smoke updated to
      the criteria signature; 142 tests pass, lint 0).
