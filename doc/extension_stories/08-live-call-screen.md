# Story 08 — Live call screen (S4)

**Ships:** the full read-only lead card shown while a call is dialing/ringing/connected.

> As a user, while the phone rings I see everything about who I'm calling — name, owner, category,
> rating, address, their Stage, and what happened on the last call — so I open every conversation
> sounding informed.

## Scope

1. **Lead card** exactly per DESIGN §6.4 / UX S4:
   - Name (`display`) + Stage badge (sheet colours, DESIGN §2.5).
   - Owner line (`ownerName · ownerTitle`).
   - Call-state row: pulsing dot (DESIGN §5 motion), label "Calling… / Ringing… / On call",
     tabular timer once connected.
   - 2-col fact grid: Phone, Category, Rating (`★ 4.6 (212)`), Address (2-line clamp), Website
     (middle-truncated link). Missing values render `—`; the grid never reflows.
   - History strip: previous Call Status as bucket-coloured chip + Notes (3-line clamp,
     expandable).
2. **Read-only during the call** (UX S4): no outcome buttons; session bar shows Stop/Stop now,
   Skip only pre-connection.
3. **State tinting** (DESIGN §7): header bottom border amber while ringing, green in-call, plus
   toolbar-icon badge (`chrome.action`) — green timer in-call, amber ringing.
4. **`aria-live="polite"`** on the call-state row (DESIGN §8); reduced-motion kills the pulses.
5. **Panel-close resilience** (UX §4.2): closing/reopening the panel mid-call rehydrates into S4
   at the correct state and timer (timer derived from call-connected timestamp, not a local
   interval).

## Acceptance criteria

- [ ] During a real call, all populated fields render per spec; a sparse lead shows `—` cells
      with identical layout.
- [ ] Stage badge and history chip colours match the sheet's colours for the same values.
- [ ] Ringing shows amber pulse + amber header border; connected shows green + running timer;
      timer digits don't jitter (tabular-nums).
- [ ] Close and reopen the panel mid-call: same screen, timer correct within 1s.
- [ ] Toolbar badge reflects ringing/in-call; clears when idle.
- [ ] Website link opens in a new tab without disturbing the Voice tab.
<!-- needs manual smoke: all six boxes are visual/live-call behaviours. Implementation notes:
     timer derives from snapshot.callStartedAt (panel-close safe, tabular-nums); stage badge +
     history chip use the tokens.css mirrors of the sheet colours; header tint + toolbar badge
     (with live m:ss timer) per DESIGN §7. Sanctioned hex exception: shared/colors.ts mirrors
     tokens.css for the chrome.action badge, which CSS cannot reach. -->

## Out of scope

Outcome capture (09). Notes writing (09/10).
