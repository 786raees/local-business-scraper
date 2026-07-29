# Design System — Google Voice Quick Dial (Chrome Extension)

**Status:** Draft v1
**Companion docs:** `CHROME_EXTENSION_PRD.md` · `CHROME_EXTENSION_ARCHITECTURE.md` ·
`CHROME_EXTENSION_UX.md` (planned)

This document defines the visual language: theme, colour tokens, typography, spacing, and the
specification of every reusable component. The UX doc covers flows and screen behaviour; this one
covers how things look.

Guiding idea: **the extension is the sheet's cockpit.** It reuses the Atlas sheet template's
palette (`server/src/sheets/sheetTemplate.ts`) — the navy header, the four outcome colour buckets,
the stage colours — so the side panel and the spreadsheet read as one product. A user glancing
between the panel and the sheet sees the same green for "Answered" in both.

---

## 1. Theme

- **Dark theme only in v1.** The panel sits beside Google Voice (light) all day during calling
  sessions; a dark panel visually separates "my dialer cockpit" from "Google's page" and reduces
  glare during long sessions. A light theme is a v2 item, keyed off `prefers-color-scheme`.
- Flat surfaces, 1px borders, small radii. No gradients, no glassmorphism, no shadows except one
  elevation level for overlays. The tool should feel like an instrument, not a landing page.
- Colour is reserved for **meaning** (call state, outcomes, stages). Chrome around the content
  stays neutral navy/grey so the meaningful colour pops.

---

## 2. Colour tokens

All tokens are CSS custom properties on `:root`. Components never use raw hex.

### 2.1 Surfaces & chrome (derived from the sheet's navy)

| Token | Hex | Use |
|---|---|---|
| `--bg-app` | `#0b0f21` | Panel background (one step darker than the sheet header navy) |
| `--bg-surface` | `#0f142d` | Cards, header bar — *the* Atlas navy (`NAVY` in sheetTemplate) |
| `--bg-raised` | `#161d3d` | Hover states, active list rows, inputs |
| `--border` | `#2a3358` | All 1px borders — the sheet's `HEADER_BORDER` |
| `--border-focus` | `#4c6fff` | Focus rings, active input borders |

### 2.2 Text

| Token | Hex | Use |
|---|---|---|
| `--text-primary` | `#eef1fa` | Headings, lead name, button labels |
| `--text-secondary` | `#a8b0cf` | Field labels, metadata, timestamps |
| `--text-muted` | `#6b7394` | Placeholders, disabled, row counts |
| `--text-inverse` | `#0f142d` | Text on light/bright fills |

Contrast: every text/background pair above meets WCAG AA (≥4.5:1 for body, ≥3:1 for large text).
`--text-muted` is only used at ≥12px and never for information that exists nowhere else.

### 2.3 Accent & call states

| Token | Hex | Use |
|---|---|---|
| `--accent` | `#4c6fff` | Primary actions (Start, Dial), links, selection |
| `--accent-hover` | `#6584ff` | Primary hover |
| `--state-dialing` | `#f2cc0c` | "Dialing…" indicator |
| `--state-ringing` | `#ffbf00` | Ringing pulse (the sheet's amber) |
| `--state-incall` | `#21c25e` | Live call indicator, call timer |
| `--state-error` | `#d83333` | Errors, hard stop (the sheet's red) |

### 2.4 Outcome colours — mirror `OUTCOME_COLOURS` in sheetTemplate.ts

The sheet colours its Call Status cells by four outcome buckets; the outcome buttons use the same
buckets so the panel and the sheet always agree:

| Bucket | Values | Token | Hex (bg / fg) |
|---|---|---|---|
| Positive | Answered, Interested | `--outcome-positive` | `#218c21` / `#ffffff` |
| Pending | Callback, Voicemail¹ | `--outcome-pending` | `#ffbf00` / `#ffffff` |
| Negative | Not Interested, Wrong Number, DNC | `--outcome-negative` | `#d83333` / `#ffffff` |
| Neutral | No Answer, Voicemail¹ | `--outcome-neutral` | `#b2b2b2` / `#000000` |

¹ The sheet buckets Voicemail as neutral grey; the panel keeps that mapping (grey) so colours
match the sheet exactly — the table lists it under Pending only to note the temptation. **Sheet
mapping wins.**

Resting state of outcome buttons is neutral surface with a coloured left edge; the full bucket
colour fills on hover/selection (see §6.3) so eight loud buttons don't shout at once.

### 2.5 Stage badge colours — mirror `STAGE_COLOURS`

Used only in the read-only Stage badge on the lead card. Same nine pairs as the sheet:
`New` `#e5e5e5/#000`, `Contacted` `#b2b2b2/#000`, `Interested` `#ffbf00/#fff`, `Demo Booked`
`#4c00cc/#fff`, `Trial Active` `#0066cc/#fff`, `Closed-Won` `#218c21/#fff`, `Closed-Lost`
`#d83333/#fff`, `Not Interested` `#e57f19/#fff`, `DNC` `#7f1919/#fff`.

---

## 3. Typography

- **Font stack:** `Inter, "Segoe UI", system-ui, -apple-system, sans-serif`. Inter is bundled
  (woff2, weights 400/500/600/700) — extensions can't load webfonts from CDNs under CSP, and the
  system fallback keeps it sane if the bundle fails.
- **Numerals:** `font-variant-numeric: tabular-nums` everywhere a number can change in place
  (call timer, row counts, cursor position) so digits don't jitter.

| Style | Size / line | Weight | Use |
|---|---|---|---|
| `display` | 20 / 28 | 700 | Lead name on the call card |
| `title` | 16 / 24 | 600 | Screen titles ("Choose spreadsheet") |
| `body` | 13 / 20 | 400 | Default text, list rows |
| `body-strong` | 13 / 20 | 600 | Buttons, selected rows, field values |
| `caption` | 11 / 16 | 500 | Field labels, metadata — UPPERCASE, `letter-spacing: 0.06em` |
| `timer` | 28 / 32 | 600 | Call timer (tabular) |

Minimum text size anywhere: 11px. No italics (poor at small sizes on low-DPI).

---

## 4. Layout, spacing, shape

- **Spacing scale:** 4px base — `4, 8, 12, 16, 20, 24, 32`. Nothing off-scale.
- **Panel geometry:** side panel width is user-controlled (~320–400px); design to a **320px
  minimum** with single-column layouts. No horizontal scroll, ever.
- **Radii:** `--radius-sm: 6px` (buttons, inputs, badges), `--radius-md: 10px` (cards),
  `--radius-full` (pills, status dots). Nothing larger.
- **Borders over shadows:** components separate by `1px solid var(--border)`.
  The only shadow is `--shadow-overlay: 0 8px 24px rgb(0 0 0 / 0.5)` on toasts/dialogs.
- **Vertical structure of the panel** (top → bottom):
  1. **Header bar** (48px, `--bg-surface`): extension name / selected tab name + gear icon.
  2. **Content region** (scrolls): pickers, or the lead card + outcome grid.
  3. **Session bar** (sticky footer, 64px): Start/Stop/Skip, progress, unsynced-write chip.

---

## 5. Iconography & motion

- **Icons:** Lucide (bundled SVG, `stroke-width: 2`), 16px inline / 20px in buttons. Icons always
  accompany a label except in the header gear and list chevrons; icon-only controls get
  `aria-label` + tooltip.
- **Motion:** functional only, 120–160ms `ease-out` for hovers/panel transitions. Two sanctioned
  ambient animations:
  - **Ringing pulse** — the call-state dot scales 1→1.25 at 1s intervals in `--state-ringing`.
  - **In-call timer dot** — steady 2s opacity breathe in `--state-incall`.
- All motion is disabled under `prefers-reduced-motion` (dots go static, transitions to 0ms).

---

## 6. Component specifications

### 6.1 Buttons

Base: `--radius-sm`, `body-strong` 13/20, padding `8px 16px` (36px tall), 120ms transitions,
focus ring `0 0 0 2px var(--bg-app), 0 0 0 4px var(--border-focus)`.

| Variant | Resting | Hover | Use |
|---|---|---|---|
| **Primary** | `--accent` bg, white text | `--accent-hover` | Start, Dial, Save key |
| **Secondary** | transparent, `1px --border`, `--text-primary` | `--bg-raised` bg | Skip, Back, Retry |
| **Danger** | transparent, `1px --state-error`, red text | red bg, white text | Stop now, Remove key |
| **Ghost** | transparent, `--text-secondary` | `--bg-raised` | gear, minor row actions |

Disabled: 40% opacity, no pointer events. Loading: label swaps to a 16px spinner, width locked so
the button doesn't resize.

**Stop is a toggle pair:** while `dialing/in-call`, the Session bar shows *Stop* (secondary,
= soft stop after this call) and *Stop now* (danger). Never a lone ambiguous "Stop".

### 6.2 Big dial control (Session bar, `ready`/`paused`)

Full-width Primary button, 44px tall, `▶ Start dialing` / `▶ Resume from row 213`. The row number
is always in the label — resuming blind is the scariest moment in a power dialer.

### 6.3 Outcome buttons

2×4 grid (2 columns), 8px gap, each 44px tall, `body-strong`, left-aligned label.

- **Resting:** `--bg-surface`, `1px --border`, with a **4px left edge** in the bucket colour.
- **Hover/focus:** background fills the bucket colour, text goes to the bucket's fg colour.
- **Selected:** filled + 2px `--border-focus` ring; other seven drop to 60% opacity.
- **Pre-selected** (ringing timeout → No Answer): filled but with a dashed border + "auto"
  caption chip, until the user confirms or changes it.
- Order matches the sheet's dropdown exactly:
  `No Answer, Voicemail, Answered, Interested / Not Interested, Callback, Wrong Number, DNC`.
- Keyboard: `1–8` select, arrows move, Enter confirms (full map in the UX doc).

### 6.4 Lead card

`--bg-surface` card, `--radius-md`, 16px padding:

1. **Name** (`display`) + Stage badge (right-aligned pill, §2.5 colours).
2. **Owner line** (`body`, `--text-secondary`): `ownerName · ownerTitle`.
3. **Call-state row:** state dot + label ("Ringing…" / "On call") + `timer` when connected.
4. **Fact grid** (2-col, `caption` labels over `body` values): Phone, Category, Rating
   (`★ 4.6 (212)`), Address (2-line clamp), Website (link, truncated middle).
5. **History strip** (`--bg-raised` inset): previous `Call Status` as a bucket-coloured chip +
   `Notes` (3-line clamp, expandable).

Empty facts render as `—` in `--text-muted`; the grid never reflows based on data presence.

### 6.5 Lists (spreadsheet & tab pickers)

Rows 44px, full-bleed, `1px --border` separators. Left: name (`body-strong`) with modified date /
row count below (`caption`, muted). Hover `--bg-raised`; selected: `--accent` 3px left bar +
raised bg. Chevron right. Search input pinned above the spreadsheet list (client-side filter).

### 6.6 Inputs

40px tall, `--bg-raised` bg, `1px --border`, `--radius-sm`, `body` text, placeholder
`--text-muted`. Focus: `--border-focus` border (no glow). Error: `--state-error` border +
11px red caption below. The key textarea on Options is `monospace, 12px`, 8 rows.

### 6.7 Badges & chips

- **Stage badge:** pill, 11px/600 uppercase, exact sheet colours.
- **Status chip** (history strip, queue rows): `--radius-sm`, 11px, bucket colour at 20% opacity
  bg + full-colour text — quieter than a filled badge.
- **Unsynced chip** (Session bar): amber dot + `2 unsynced`, click → queue popover.

### 6.8 Progress indicator (Session bar)

`Row 213 · 47 of 312` (`caption`, tabular) above a 4px track: `--bg-raised` track, `--accent`
fill, no animation. Skipped-no-phone count appears in a tooltip, not inline.

### 6.9 Toasts & dialogs

- **Toast:** bottom of panel above the Session bar, `--bg-raised` + border + `--shadow-overlay`,
  auto-dismiss 4s, max one at a time. Variants: success (green dot), error (red dot, sticky until
  dismissed).
- **Dialog** (rare — "Sheet changed, reload tab?"): centered card at 90% panel width, scrim
  `rgb(0 0 0 / 0.6)`. One primary + one secondary action, never three.

---

## 7. Screen-level colour behaviour

The **call-state accent** tints the panel so the current state is legible from across the room:

- Header bar bottom border (2px) takes the state colour: amber while ringing, green in-call,
  red in error, `--border` otherwise.
- The extension's toolbar icon badge mirrors it (`chrome.action.setBadgeBackgroundColor`):
  green + timer while in-call, amber while ringing, red count when unsynced writes > 0.

---

## 8. Accessibility

- WCAG AA contrast throughout (verified per token pair in §2).
- Full keyboard operability; visible focus ring on every interactive element (spec in §6.1).
- Call-state and outcomes are never colour-only: every state has a text label, every outcome
  button its name, chips carry text.
- `aria-live="polite"` on the call-state row and toast region so screen readers hear
  "Ringing… / Call ended".
- Hit targets ≥ 40×40px for everything a user clicks during a live call (outcome grid, session
  bar) — mid-call clicks are hurried clicks.

---

## 9. Token file

Single source of truth `src/sidepanel/tokens.css` (imported by options too). Everything in §2–§4
as custom properties; components reference tokens only. Any new colour must join a token — a raw
hex in a component file fails review.
