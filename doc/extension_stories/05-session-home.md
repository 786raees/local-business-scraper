# Story 05 — Session home (S3)

**Ships:** the launchpad screen — resume card, big Start button, start-from, filter select.

> As a user, I open the panel and immediately see where I left off ("You stopped at row 213 —
> Big Sky Dental") and one big button to resume — so starting a calling session takes one click
> (or `Space`) and zero remembering.

## Scope

1. **S3 layout** per UX S3 and DESIGN §4/§6:
   - Header context line: tab name + row count, gear icon, `⇄` change-list icon.
   - Resume card (hero): first-session copy ("312 leads, 298 dialable" + skipped tooltip) vs
     returning copy ("You stopped at row 213 — **<name>** · <when>").
   - Big primary button (DESIGN §6.2): `▶ Start dialing` / `▶ Resume from row N` — row number
     always in the label. `Space` triggers it.
2. **Start from…** ghost button → inline row-number input with live name preview
   ("Row 250 → *Hilltop Vet Clinic*") + "Start from top" (UX S3.4). Invalid/out-of-range rows
   show the input error state.
3. **Filter select**: `All rows / Uncalled only / Retry (No Answer + Callback)`, default
   `Uncalled only`, persisted; changing it updates the dialable counts live.
4. **Resume persistence**: `resume:<spreadsheetId>:<tabTitle>` per ARCHITECTURE §8, written by
   the session (story 07) — this story reads it and renders the card.
5. **Pre-start Voice check** (UX S3 last ¶): Start verifies a Voice tab exists/creates one; if
   the content script reports logged-out, show the fix-it banner ("Log in to Google Voice, then
   press Start again" + Open Voice button). Actual dialing is story 07 — behind a feature flag
   here, Start may land in a stub `dialing` phase.
6. **Session-bar shell** (sticky footer): progress line `X of Y · row N` + placeholder controls,
   so stories 07–09 fill in behaviors, not layout.

## Acceptance criteria

- [ ] Fresh tab: first-session card + "Start dialing"; with a stored resume point: resume card
      with business name and "Resume from row N".
- [ ] Start-from preview shows the correct business name as the number changes; confirming moves
      the cursor; "Start from top" resets it.
- [ ] Filter change updates counts instantly and survives panel reopen.
- [ ] With no Voice tab open, Start opens one; with a logged-out Voice, the fix-it banner shows.
      <!-- ensureVoiceTab shipped; the logged-out signal needs the story-06 content script,
           so that half completes there -->
- [ ] `Space` starts; gear opens options; `⇄` returns to S1 (with confirm if mid-session later).
<!-- needs manual smoke: all five boxes are live-UI behaviours; the underlying logic
     (findCursorForRow, per-filter dialable counts, cursor clamp, resume persistence) is
     unit-tested in leads.test.ts / state.test.ts — see /implement 05 report. -->

## Out of scope

Real dialing loop (07), live-call UI (08).
