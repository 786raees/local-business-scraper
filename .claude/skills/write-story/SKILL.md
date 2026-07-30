---
name: write-story
description: Author a new numbered user story for either the extension (doc/extension_stories/) or Atlas (doc/gms_stories/). Usage: /write-story <feature description> [ext|gms]. Reads the PRD/Architecture/Design/UX docs and existing code first, then writes a story that /implement or /implement-gms can ship.
---

# /write-story — author one user story

The user invoked `/write-story $ARGUMENTS`. The arguments describe the feature to turn into a
story. Decide the target suite first:

- **ext** → `doc/extension_stories/` (Google Voice Quick Dial extension)
- **gms** → `doc/gms_stories/` (Atlas — the scraper server + web app)

If the arguments contain an explicit `ext`/`gms` token, use it. Otherwise infer from the
feature ("while calling", "lead card", "picker" → ext; "scrape", "results table", "export",
"store" → gms). If genuinely ambiguous, ask the user before writing.

## Step 1 — Load context (always, before writing anything)

Read ALL of the target suite's docs, in this order:

- ext: `doc/CHROME_EXTENSION_PRD.md`, `doc/CHROME_EXTENSION_ARCHITECTURE.md`,
  `doc/CHROME_EXTENSION_DESIGN.md`, `doc/CHROME_EXTENSION_UX.md`,
  `doc/extension_stories/README.md`
- gms: `CLAUDE.md` (repo root), `doc/GMS_PRD.md`, `doc/GMS_ARCHITECTURE.md`,
  `doc/GMS_DESIGN.md`, `doc/GMS_UX.md`, `doc/gms_stories/README.md`

Then:

1. Skim the two or three most recent story files in the target folder — the new story must
   match their voice, structure, and level of detail.
2. Read the existing source the feature would touch (grep for the types, components, and
   modules involved). A story that names real files, real functions, and the mechanisms
   already in place (e.g. "reuse `reanchorCursor`", "extend `matchesFilter`") is worth ten
   that hand-wave. Never spec something the code already does.
3. If the feature spans both sides (an Atlas column the extension displays), write ONE
   story in the primary suite and note the correlated story as a follow-up — ask the user
   whether to write both now.

## Step 2 — Write the story

Create `doc/<suite>_stories/<NN>-<kebab-slug>.md` where `<NN>` is the next free number in
the README table. Structure (matching the existing stories):

1. `# Story NN — <Title>: <one-line hook>`
2. `**Ships:**` — the user-visible increment in one or two sentences.
3. A `>` blockquote user story ("As a …, I can … — so …").
4. `## Dependency` — which prior stories it needs, and whether they're shipped.
5. `## Design decisions (bind the implementation)` — only when the feature has real
   semantic traps (blank data, migrations, identity, ordering). Each decision states the
   rule AND the failure it prevents. Include concrete TypeScript shapes for new types.
6. `## Scope` — numbered items, each naming the actual files/modules to touch and the
   tests to write. Tests are always a scope item, never an afterthought.
7. `## Out of scope` — explicit non-goals, including anything that sounds adjacent but
   belongs in another story or v2.
8. `## Acceptance criteria` — `- [ ]` boxes, each independently checkable, each pointing
   at the evidence that would prove it (a named test, a grep, a build command). Include
   the suite's standard final box (full build/test/lint green, prior tests unbroken).

Hard rules the story itself must respect and restate where relevant (they are the repo's
learned-by-breaking-something invariants — see the docs read in Step 1):

- ext: single-cell RAW Sheets writes only; columns by header name; selectors only in
  `content/selectors.ts`; tokens only, no raw hex; key in `storage.local` never `sync`;
  "a wrong sheet write is worse than a missed one".
- gms: hand-synced `types.ts` pair; the store add-a-field checklist; scaling rules
  (stream, paginate, throttle); selectors only in `scraper/selectors.ts`; `hl=en&gl=us`;
  Sheets RAW + header-name matching + the Outreach ARRAYFORMULA.

## Step 3 — Register and close out

1. Add the story's row to the suite README table (and extend the dependency-shape line if
   the story introduces a new dependency edge).
2. Final message: a short summary of what the story specifies, the key design decisions and
   why, what was deliberately left out — and the command to build it
   (`/implement NN` or `/implement-gms NN`).
3. Do NOT implement anything. This skill only writes the story. Do not commit unless asked.
