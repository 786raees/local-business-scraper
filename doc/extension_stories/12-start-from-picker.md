# Story 12 — Start-from lead picker: find your place without knowing a row number

**Ships:** "Start from…" becomes a searchable, browseable lead picker — users find their
starting lead by *name* (or by scanning the list), never by remembering a sheet row number.

> As a user, when I want to start mid-list I just type a few letters of the business name — or
> scroll a list that shows each lead's status — and pick it. I never have to open the
> spreadsheet to look up a row number.

## Problem (why this story exists)

The current S3 "Start from…" (story 05) is a bare row-number input with a name preview. That
design assumes the user *knows* a row number — but nobody remembers rows; they remember
"I stopped around Hilltop Vet" or "I want to redo this morning's voicemails". Forcing a number
means opening the sheet, finding the business, reading the row, and typing it back — four steps
of friction and a transcription-error risk, and it's hostile to keyboard-only and screen-reader
users (a number field with a live preview is a guessing game).

## Scope

1. **Replace the row input with a lead picker** (expands inline in S3, same trigger):
   - **Search-first**: an autofocused text input filtering the *dialable* leads by business
     name (case/whitespace-insensitive substring, same normalisation as `findCursorByName`).
     Matching is client-side over the loaded list — instant, no network.
   - **Browseable list** under the search box: virtualised/windowed rows (lists can be tens of
     thousands of leads — render a window, not the world; cap DOM rows and window by scroll).
   - Each row per DESIGN §6.5: business name (`body-strong`), and a sub-line with
     `row N · phone`, plus the lead's current **Call Status chip** (bucket colours, DESIGN
     §6.7) so users can visually navigate by "where the statuses stop".
   - Picking a row calls the existing `session/setCursor` with that lead's `rowIndex` — the
     backend contract does not change.
2. **Jump shortcuts** above the list (one tap, zero typing) — computed from the loaded leads:
   - **First uncalled** — the first dialable lead with empty Call Status (where fresh work
     starts; under the `uncalled` filter this equals "Start from top" of the remaining work).
   - **After last called** — the lead following the highest row with any logged status
     ("continue where the sheet's work ends", robust even if the resume point is stale).
   - **Resume point** — the persisted per-tab cursor, labelled with the business name
     ("Row 213 · Big Sky Dental"), shown only when one exists.
   - **Top of list.**
   Each shortcut previews its target lead (name + row) before confirming.
3. **Row number still works** — typing digits into the same search box matches by `rowIndex`
   as well as by name (power users and support conversations keep the fast path; no separate
   mode or toggle).
4. **Accessibility** (the point of this story — DESIGN §8 applied to the picker):
   - Full keyboard operation: `↓/↑` move through results from the search box, `Enter` picks,
     `Esc` closes; focus is trapped in the picker while open and returns to the Start button
     on close.
   - Proper combobox semantics: `role="combobox"` + `aria-expanded` on the input,
     `role="listbox"`/`role="option"` + `aria-activedescendant` for results, so screen
     readers announce "Hilltop Vet Clinic, row 250, No Answer, 3 of 12".
   - `aria-live="polite"` result count ("12 matches") on filter changes.
   - Hit targets ≥ 44px rows; visible focus ring per DESIGN §6.1; no colour-only status
     (chips carry their text).
   - Empty-search state shows the jump shortcuts + the list from the current cursor position
     (not row 2), so "just browse from where I am" is the default.
5. **Pure helpers, unit-tested** (in `background/leads.ts` or a new `leads` util):
   - `searchLeads(dialable, query)` — name substring + digit→rowIndex matching, capped result
     count with "N more…" indicator.
   - `firstUncalledCursor(dialable)` and `afterLastCalledCursor(dialable)` for the shortcuts.

## Out of scope

- Changing cursor semantics, `session/setCursor`, or any background contract.
- Searching across non-dialable leads (rows the current filter excludes stay hidden — the
  picker must never offer a lead the session wouldn't dial; if a searched name is excluded by
  the filter, say so: "Hilltop Vet is filtered out (already called)").
- Fuzzy/typo-tolerant matching (v2 if substring proves insufficient).
- Any change to S5/S4 or the dialing loop.

## Acceptance criteria

- [ ] Typing "hill" lists Hilltop Vet Clinic with its row, phone, and status chip; `Enter`
      sets the start point; the resume card reflects it by name.
- [ ] Typing "250" finds the lead at row 250 (digit input needs no separate mode).
- [ ] All four jump shortcuts land on the correct lead on a fixture with mixed statuses, and
      each shows its target's name before confirming.
- [ ] A 10k-lead list opens, scrolls, and filters without jank (windowed rendering, capped
      results).
- [ ] Keyboard-only: open picker → search → arrow to a result → Enter → Start, without the
      mouse; `Esc` returns focus to the Start button.
- [ ] Screen reader (NVDA or Chrome's built-in) announces the combobox, options with
      name/row/status, and the live match count.
- [ ] A name excluded by the current filter yields the "filtered out" explanation, not an
      empty shrug.
- [x] Unit tests: `searchLeads` (name, digits, cap), `firstUncalledCursor`,
      `afterLastCalledCursor` on mixed fixtures.
<!-- needs manual smoke: boxes 1–7 are live-UI/AT behaviours — search+pick, digit query,
     shortcut targets, 10k scroll smoothness, keyboard-only flow (arrows/Enter/Esc with focus
     returning to Start), screen-reader announcements, and the filtered-out explanation.
     The matching/shortcut logic behind them is unit-tested in leads.test.ts. -->

## Dependencies

Requires stories 04/05 (loaded leads, S3, `session/setCursor`). Touches only the side panel +
pure lead helpers.
