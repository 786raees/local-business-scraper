# Story 06 — Google Voice content script: dial, hang up, detect state

**Ships:** programmatic control of the Voice dialer and reliable call-state events.

> As a user, when the extension is told to call a number, the Google Voice tab dials it, and the
> extension always knows whether the call is dialing, ringing, connected, or ended — so the
> session loop (next story) has trustworthy hands and eyes.

## Scope

1. **`content/selectors.ts`** — every Voice DOM selector, verified against the live product
   (ARCHITECTURE §6.1). Rules: prefer `aria-label`/`gv-*` elements over generated class names;
   presence-based detection over label text (Voice may be localized). This is the only file that
   touches the Voice DOM shape.
2. **`content/dialer.ts`** (ARCHITECTURE §6.2):
   - `dial(phone)`: focus dialpad input, set value via native setter + `input` event (Angular),
     click call. Fallback: navigate to the `?a=nc,%2B<number>` deep link if the dialpad isn't
     mounted.
   - `hangUp()`: click end-call when present.
3. **`content/callState.ts`** (ARCHITECTURE §6.3): MutationObserver-driven derivation to
   `idle | dialing | ringing | in-call | ended`, using widget presence + call timer. Emits
   `voice/callState` on every change. Observer connected only during an active session; inert
   otherwise.
4. **Failure signals** (ARCHITECTURE §6.4): `dialer-not-found` (selectors miss for 5s after a
   dial request), `not-logged-in` (signed-out marker). Never touches credentials.
5. **`background/voiceController.ts`** (ARCHITECTURE §7.2): `ensureVoiceTab()` (find or create,
   focus on dial, never reuse a non-Voice tab), `chrome.scripting.executeScript` injection when
   messaging finds no receiver, `voice/probe` for state re-sync after worker restart.
6. **Dev harness**: a hidden "test dial" input (dev builds only) in the panel to drive
   dial/hangUp/state manually before the session loop exists.

## Acceptance criteria

- [x] From the dev harness, dialing a real number rings the phone; state events arrive in order
      `dialing → ringing → in-call → ended` (answered) and `dialing → ringing → ended`
      (unanswered/hang-up); `hangUp()` ends a live call.
      <!-- verified live 2026-07-29 after fixing selectors against the real Voice DOM:
           input is placeholder-based (no aria), call button aria^="Call", active call
           = end-call button presence (gv-in-call is always mounted), deep link must be
           account-aware (/u/9/ session was logged out by a hardcoded /u/0/) -->
- [x] Phone formats as Atlas stores them (`+1 305-697-3490`, `(305) 697-3490`) all dial.
- [ ] With Voice signed out, a dial request produces `not-logged-in` within 5s.
- [ ] A Voice tab opened *before* extension install still works (injection fallback).
- [x] Browsing Voice manually with no session active produces zero events (observer inert).
      <!-- tracker inertness unit-tested; observer additionally connects only on voice/dial -->
- [x] All DOM queries live in `selectors.ts` — grep proves no selector strings elsewhere.
<!-- needs manual smoke: boxes 1–4 need a live Voice account and a real phone — use the dev
     harness (localStorage['gvqd-dev']='1' in the panel console). Selectors in selectors.ts are
     best-effort against gv-* elements/aria-labels and MUST be verified on the live product;
     any miss is a selectors.ts-only fix. -->

## Out of scope

The session loop consuming these events (07). Ringing timeout (07 — it's an alarm, not DOM).
