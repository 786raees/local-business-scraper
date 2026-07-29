# Story 09 — Outcome screen & write-back (S5)

**Ships:** the one-keypress logging loop — outcome grid, notes, countdown, and the real
single-cell sheet write.

> As a user, when a call ends I press `1`–`8`, the Call Status lands in the right sheet cell, and
> the next call dials itself after a short countdown — so logging costs one keypress per call.

## Scope

1. **Outcome grid** per DESIGN §6.3 / UX S5: 2×4, sheet-dropdown order, key-cap hints `1`–`8`,
   bucket-coloured left edges, fill on hover/selection, others dim to 60% on select.
   Pre-selected (timeout) state: filled + dashed border + "auto" chip; any number overrides;
   inaction confirms No Answer at countdown end.
2. **Note field** (UX S5.3): single line, `N` focuses, Enter confirms outcome + note; note is
   date-prefixed (`YYYY-MM-DD: `) and appended to the Notes cell.
3. **Write-back** (ARCHITECTURE §5.2/§5.4):
   - Stale-row guard: re-read the row's `name` cell; mismatch → error phase "Sheet changed —
     reload the tab", **no write** (UX §4.1).
   - Call Status: `updateCell` single-cell RAW to `'<tab>'!<CallStatusLetter><rowIndex>`.
   - Notes (when present): read current cell → append → single-cell RAW write.
   - Update the in-memory lead so the history strip is fresh if re-encountered via `retry`
     filter.
4. **Countdown + undo** (UX S5.4–5.5): slim sweep bar for the inter-call delay showing
   "Next: <name>"; `Space`/click dials now, `Esc` pauses. Toast "Logged **X** — Undo": undo
   within the delay cancels the pending write and returns to S5. (The write executes at
   countdown end or on dial-now — whichever first — so undo is always safe.)
5. **Keyboard map** wired: `1`–`8`, `Enter`, `N`, `Space`, `Esc` (UX §3).
6. **S6 end-of-list** (UX S6): session tally (dialed/answered/interested from this session's
   outcomes) + Back to leads / Change tab.

## Acceptance criteria

- [ ] Pressing `3` after a call writes `Answered` to the correct row's Call Status cell in the
      real sheet; the sheet's conditional colour appears; Outreach formula column intact.
- [ ] Outcome + note writes both cells; note is appended after existing text with date prefix.
- [ ] Undo during the countdown leaves the sheet untouched and re-opens S5.
- [ ] Re-sorting the sheet mid-session then logging → "Sheet changed" error, sheet unmodified.
- [ ] Timeout flow: auto No Answer logs itself if untouched; pressing `6` first logs Callback.
- [ ] Full loop measured: from call end to next dial, one keypress + countdown, no other input.
- [ ] End of list shows correct tallies.
<!-- needs manual smoke: all boxes are live-sheet/live-call flows. The logic behind each is
     unit-tested: undo transitions (session.test.ts), notesAppend/date prefix, header-mapped
     cell resolution (incl. reordered columns), and the stale-row namesMatch guard
     (outcomes.test.ts). Write execution is DEFERRED to the end of the between-calls
     countdown, which is what makes undo sheet-safe by construction. -->

## Out of scope

Durability of writes across failures/restarts (story 10 — this story may fail loudly on network
errors).
