# Story 17 — Settings page UI: from a pile of rows to a page with a shape

**Ships:** the options page reorganised into scannable sections (Connection · Dialer ·
Recording · Danger zone) with proper toggle switches, grouped cards, aligned controls, and
copy that explains consequences — replacing today's single column where the key dropzone,
number inputs, a consent paragraph, and Remove key all run together.

> As a user opening Settings for the first time, I can see at a glance what's connected,
> what the dialer will do, and what recording requires (consent → microphone → toggle, in
> that order) — so I can set the extension up without reading a manual or hunting for
> which checkbox unlocks which.

## Dependency

Needs stories 01 (KeySetup), 11 (SettingsSection), 15/16 (recording settings + the
mic-grant control). All shipped. Pure UI reshuffle — no storage schema, message, or
worker changes.

## Design decisions (bind the implementation)

1. **Sections are the unit, not rows.** Four cards, each with an `.hint` eyebrow title
   and one job: **Connection** (key status, service-account email + copy, share hint),
   **Dialer** (delays, ringing timeout, default dial status + criteria summary),
   **Recording** (consent → mic access → enable → minimum duration, visually ordered as
   the dependency chain it is), **Danger zone** (Remove key, Reset settings — the only
   red on the page). Today's page interleaves these; a misclick on Remove key sits two
   rows from a delay input.
2. **The recording section renders its dependency chain as steps.** Consent, mic
   permission, and the enable toggle are sequential prerequisites (stories 15/16) — the
   UI shows them as a numbered/stepped list where each row is visually inert (muted, not
   hidden) until the previous one is satisfied. Hiding locked steps is forbidden: a user
   who can't find the record toggle files "recording is broken", not "I haven't
   consented" — this exact confusion motivated the story.
3. **Toggle switches for booleans, and one switch component.** Consent and
   record-enable become a `Switch` (button with `role="switch"` + `aria-checked`,
   keyboard-operable, tokens only — thumb/track via `--accent`/`--bg-raised`). Native
   checkboxes remain nowhere on the page; number inputs keep `keyinput num` but get
   consistent right-alignment and unit suffixes rendered outside the input.
4. **No behaviour changes hide inside the reshuffle.** Every save path still goes
   through `settingsStore.set`/`clampSettings`; the consent-forces-off rule, the mic
   permission query/grant flow, and key validation are moved, not modified. The story
   19-line acceptance is a diff discipline: `storage.ts`, `messages.ts`, and everything
   under `background/` are untouched.
5. **One place for section layout.** New `options/OptionsCard.tsx` (title + children) and
   `Switch.tsx`; `KeySetup.tsx` keeps only the connection logic and composes cards —
   today it owns the whole page layout, which is why every addition (stories 15/16)
   landed as another appended row.

## Scope

1. **Components** (`src/options/`): `OptionsCard.tsx` (eyebrow title, optional
   description, children) and `Switch.tsx` (decision 3); `KeySetup.tsx` becomes the page
   composer — connection card states (empty/validating/connected/error) unchanged in
   logic, restyled into the card grammar.
2. **SettingsSection split** (`src/options/SettingsSection.tsx` →
   `DialerSection.tsx` + `RecordingSection.tsx`): Dialer card (delay, timeout, default
   status + the story-14 criteria summary line); Recording card as the decision-2 step
   chain, absorbing the story-15 consent copy and the mic-grant control with its
   granted/denied/prompt states.
3. **Danger zone** (`KeySetup.tsx` + `DangerSection.tsx`): Remove key + Reset settings
   together, red-bordered card, each with a one-line consequence caption ("dialing stops
   working until a new key is added").
4. **Styles** (`src/options/options.css`): card grid (max-width bump to ~640px, cards
   full-width), `.switch` styles, step-chain styles (muted locked rows, step numbers),
   aligned `.setting-row` (label left, control right, fixed control column). Tokens
   only — the grep rule stands.
5. **Copy pass**: every control gets consequence-first microcopy (what happens, not what
   the setting is called); the recording section's legal line stays verbatim from
   story 15 (consent text is load-bearing, not editable copy).
6. **Tests** (`test/optionsUi.test.ts`): `Switch` semantics via a small render-free
   check of props contract is NOT enough — but the project has no DOM-render test rig,
   so the testable surface is: sections render pure data → assert the step-chain
   ordering/lock logic as a pure function (`recordingSteps(settings, micState)` →
   `[{ key, locked }]`) exported from `RecordingSection.tsx`, plus regression greps in
   the acceptance boxes. Keep `recordingSteps` pure and unit-tested (consent unlocks
   mic, mic unlocks enable, enable unlocks duration).

## Out of scope

- Any storage/message/worker change; any new setting or removed setting.
- The side panel's UI (S0–S6 live in the panel and have their own design story history).
- A first-run wizard/onboarding flow; import/export of settings.
- Theming beyond the existing token set; no new tokens, no raw hex.

## Acceptance criteria

- [ ] The page shows exactly four cards in order (Connection, Dialer, Recording, Danger
      zone); every existing control is present and functional — manual smoke walkthrough.
- [ ] Recording renders as a stepped chain: with no consent, mic + enable + duration rows
      are visibly muted (not hidden); granting each step unlocks the next
      (`recordingSteps` unit tests cover all lock states).
- [ ] Booleans are `role="switch"` buttons, keyboard-operable (Space/Enter), no native
      checkboxes remain on the page (grep `type="checkbox"` under `src/options/` → none).
- [ ] Behaviour untouched: `git diff` for the story touches only `src/options/**`
      (+ its test file) — `storage.ts`, `messages.ts`, `background/**` unchanged.
- [ ] The consent legal sentence and the clampSettings-enforced consent rule are intact
      (existing recording.test.ts consent-gate tests still pass, verbatim copy present).
- [ ] Tokens only: no raw hex outside `tokens.css` (grep), all new styles in
      `options.css` reference `--*` variables.
- [ ] Full suite green (`npm run build && npm test && npm run lint` in `extension/`);
      prior stories' tests untouched.
