# Story 11 — Polish & hardening: settings, errors, accessibility, release

**Ships:** the v1 release build — every remaining UX edge, the settings surface, and the final
accessibility/QA pass.

> As a user, every failure I can hit has a named fix, the timings suit me, and the extension
> feels finished — so I trust it with a full day of calling.

## Scope

1. **Settings** (gear → options section): inter-call delay, ringing timeout, dial filter
   default — persisted per ARCHITECTURE §8 `settings`, with sane bounds and reset-to-default.
2. **Complete error matrix** (UX §4.1 / ARCHITECTURE §9) — audit that each row exists and follows
   the fix-it pattern (one sentence + one button): Voice logged out, sheet not shared,
   `dialer-not-found` (with "Voice may have updated" hint), sheet re-sorted → **Reload leads**
   which re-reads the tab and re-finds the cursor by business name, write failures chip.
3. **Change-lists flow** (UX §4.4): `⇄` mid-session confirm dialog ("Pause and switch lists?");
   per-tab resume points verified across switches.
4. **Toasts & dialogs** finalized per DESIGN §6.9 (one at a time, error toasts sticky).
5. **Accessibility pass** (DESIGN §8): tab order on every screen, focus rings, `aria-live`
   regions, colour-blind check (no colour-only meaning), hit targets ≥40px on S5/session bar,
   `prefers-reduced-motion` verified.
6. **First-session walkthrough QA** (UX §5): perform the scripted 5-click journey on a clean
   Chrome profile with a fresh Atlas export; fix anything that breaks the count.
7. **Release build**: version 1.0.0, icons (16/32/48/128), store-ready zip via `npm run build`;
   README in `extension/` covering install-unpacked + service-account setup, linking these docs.
8. Full regression: all vitest suites green; manual smoke checklist executed against a real
   sheet + real Voice account and archived in the repo.

## Acceptance criteria

- [ ] Every error row in ARCHITECTURE §9 is reproducible and shows its specified banner+action.
- [ ] Settings changes take effect on the next call without restart and persist across restarts.
      <!-- clamp + persistence logic tested (settings.test.ts); the interpreter reads settings
           per effect, so changes apply on the next call by construction — live check manual -->
- [x] "Reload leads" after an external re-sort finds the previous business by name and resumes at
      its new row.
      <!-- findCursorByName unit-tested; wired via session/reloadLeads — live re-sort manual -->
- [ ] Keyboard-only session: complete 3 calls without touching the mouse.
- [ ] Clean-profile walkthrough matches UX §5's click count (5 clicks to first call).
- [x] Build zip loads with no warnings; all tests and lint pass.
      <!-- gv-quick-dial-1.0.0.zip built; 109 tests + lint green; "no warnings" confirmed at
           chrome://extensions load time -->
<!-- needs manual smoke: run extension/SMOKE.md end-to-end on a clean profile — it encodes
     every remaining box (error matrix, keyboard-only run, 5-click walkthrough). -->

## Out of scope (v2 backlog)

Light theme, OAuth consent flow instead of service account, multiple phone columns, callback-date
capture, SMS — see PRD non-goals and open questions.
