# Manual smoke checklist (v1.0.0)

Run on a clean Chrome profile with a fresh Atlas export and a live Voice account before any
release. Mechanical checks (`npm run build && npm test && npm run lint`) must be green first.

## First-session walkthrough (UX §5 — must be ≤5 clicks to first call)

- [ ] Load unpacked `dist/` — no manifest warnings; icon shows in toolbar.
- [ ] Click 1: toolbar icon → connect card → Open setup.
- [ ] Drop key file → "Connected as …" instantly; Click 2: copy email chip; share sheet.
- [ ] Click 3: pick spreadsheet (search works, Recent pins). Click 4: pick tab
      (non-Atlas tab disabled with "missing: …").
- [ ] Click 5: ▶ Start dialing → Voice opens, first call dials.

## The loop

- [ ] Ringing: amber pulse + amber header border + ☎ badge; lead card fully populated;
      sparse lead shows — cells, same layout.
- [ ] Answered: green dot, m:ss timer in panel AND toolbar badge; panel close/reopen mid-call
      keeps the timer right.
- [ ] Call ends → outcome grid; press `3` → `Answered` lands in the correct row with the
      sheet's colour; Outreach formula intact.
- [ ] `N` + note + outcome → Notes cell gets `YYYY-MM-DD: …` appended.
- [ ] Countdown: "Next: <name>"; `Space` dials now; `Esc` pauses; Undo leaves the sheet
      untouched and reopens the outcome screen.
- [ ] Let one ring out (timeout): auto-hangup, "auto Ns" chip counts down, logs No Answer.
- [ ] Stop = finishes call flow then pauses; Stop now = hangs up instantly; Resume continues
      from "row N — <name>".
- [ ] Keyboard-only: 3 consecutive calls without touching the mouse.

## Resilience

- [ ] Worker offline (devtools): 3 outcomes → "3 unsynced" chip + red badge; dialing continues;
      back online → all drain correctly.
- [ ] Unshare sheet → queue pauses with copy-email fix-it; re-share + Retry now → drains.
- [ ] Kill service worker between calls → reopen panel → loop resumes.
- [ ] Re-sort the sheet mid-session → "rows moved" error, sheet unmodified; **Reload leads**
      re-finds the business by name and resumes there.
- [ ] Voice signed out → "Google Voice is signed out." + Open Voice + Resume works.
- [ ] 10 straight unanswered → safety-valve pause message.

## Settings & misc

- [ ] Gear → change pause to 5s → takes effect next call, survives browser restart;
      Reset restores 3s/60s/Uncalled.
- [ ] ⇄ mid-session → "Pause and switch lists?" dialog; each tab keeps its own resume point.
- [ ] End of list → tally screen with correct counts.
- [ ] `prefers-reduced-motion`: pulses static, countdown still functional.
