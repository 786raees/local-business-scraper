# Design — Atlas (Google Maps Scraper web UI)

**Status:** Living document — describes the UI system as implemented
**Companion docs:** `GMS_PRD.md` · `GMS_ARCHITECTURE.md` · `GMS_UX.md`

Atlas's web UI is a dark, cartography-flavoured instrument panel: "surveyor's field desk" —
ink-navy surfaces, parchment text, a hot survey-orange accent, topographic contour washes on
header/empty states. Tailwind is the styling system; the theme lives in
`web/tailwind.config.js` and `web/src/index.css`. **New UI must use these tokens/utilities —
never introduce ad-hoc colours or fonts.**

---

## 1. Colour palette (Tailwind theme names)

| Token | Hex | Use |
|---|---|---|
| `ink-900` | `#0B1322` | deepest background (sidebar wash) |
| `ink-800` | `#0E1726` | app background |
| `ink-700` | `#111B2E` | inputs, cards |
| `ink-600` | `#16223A` | raised/hover surfaces |
| `ink-500` | `#1C2A45` | highest surface step |
| `line` | `#26344F` | all borders, scrollbar thumb |
| `parchment` | `#E8E6DF` | primary text |
| `muted` | `#8A97AD` | secondary text, eyebrows |
| `survey` | `#FF6B3D` | the accent: primary actions, focus rings, live emphasis |
| `teal` | `#3FB9A6` | success / positive (done tasks, has-data) |
| `amber` | `#F2B33D` | in-progress / warnings |
| `rose` | `#F2555A` | errors / destructive |
| `violet` | `#9B7BFF` | auxiliary accent (rare) |

`color-scheme: dark` is set globally; there is no light theme.

## 2. Typography

| Family | Token | Use |
|---|---|---|
| Space Grotesk | `font-display` | headings, the app title |
| Inter | `font-sans` (default) | body/UI |
| JetBrains Mono | `font-mono` | numbers, counts, the `.eyebrow` label style |

Shared component classes (in `index.css` `@layer components`):
- **`.field`** — the standard input: `ink-700` bg, `line` border, `survey` focus border +
  ring. Every text input/select uses it.
- **`.eyebrow`** — mono 10px uppercase `tracking-[0.18em] text-muted` section labels; the
  signature label style of the sidebar panels.
- **`.contour`** — the topographic radial-gradient wash (survey-orange + teal at low alpha)
  for the header and empty states.

## 3. Layout

- Full-height app: `TopBar` on top; below it a fixed **340px left sidebar**
  (`ink-900/40`, right border `line`, `space-y-6`, own scroll) with the job-builder panels,
  and a main column with `QueuePanel` above the flex-filling `ResultsTable`.
- Density is compact: small text (`text-sm` and below), tight paddings — this is an
  operator's tool, not a marketing page.

## 4. Component conventions

- **Panels** (sidebar sections): `.eyebrow` heading + content; separated by the sidebar's
  vertical rhythm, not boxes-in-boxes.
- **Status colouring** (queue chips, counters): queued = muted, running = amber/survey,
  done = teal, error/blocked = rose. Text accompanies colour — never colour-only.
- **Tables:** virtualized rows, `line` row separators, mono for numeric cells, sticky
  header on `ink-800`.
- **Buttons:** primary = `survey` fill; secondary = bordered `line` on transparent;
  destructive = `rose`. Focus states via ring utilities in the accent colour.
- **Scrollbars** are styled (10px, `line` thumb) — keep custom scroll areas consistent.
- **Motion:** minimal; `prefers-reduced-motion` globally collapses all animation/transition
  durations (already wired in `index.css`).

## 5. Adding UI (rules)

1. Reuse `.field`, `.eyebrow`, the panel rhythm, and the palette table above.
2. Enumerable states get the §4 status colours with text labels.
3. Numbers that update live (counts, progress) render in `font-mono`.
4. No new fonts, no raw hex in components — extend `tailwind.config.js` if a token is
   genuinely missing.
5. Anything wide (tables, long URLs) scrolls inside its own container; the app never
   scrolls horizontally.
