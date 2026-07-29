---
name: implement
description: Implement a numbered user story for the Google Voice Quick Dial extension. Usage: /implement <story-number> [extra instructions]. Reads all design docs in doc/, the matching story in doc/extension_stories/, implements it fully, then runs a final quality checklist against the acceptance criteria.
---

# /implement — ship one extension story

The user invoked `/implement $ARGUMENTS`. The first token is the story number (e.g. `00`, `3`,
`07` — normalize to two digits). Everything after it is extra instructions that **override or
extend** the story file — user instructions win over the docs on any conflict.

## Step 1 — Load context (always, in this order)

Read ALL of these before writing any code:

1. `doc/CHROME_EXTENSION_PRD.md` — what & why, the sheet contract.
2. `doc/CHROME_EXTENSION_ARCHITECTURE.md` — module layout, message contracts, state machines,
   storage, error matrix. This is the technical authority.
3. `doc/CHROME_EXTENSION_DESIGN.md` — tokens, typography, component specs. UI code must match it.
4. `doc/CHROME_EXTENSION_UX.md` — screen flows, keyboard map, edge flows.
5. `doc/extension_stories/README.md` — the story index and dependency shape.
6. `doc/extension_stories/<NN>-*.md` — the target story (glob for the number prefix).

Also skim the previously completed stories' files (lower numbers) and the existing `extension/`
source to understand what already exists — never re-scaffold or duplicate what a prior story
built. If the target story's dependencies (per the README dependency shape) are clearly not
implemented yet, stop and tell the user which story must come first.

## Step 2 — Plan

From the story's **Scope**, produce a short implementation plan (files to create/modify, tests to
write). Respect the story's **Out of scope** section strictly — do not build ahead. Track the
plan with the task tools (TaskCreate/TaskUpdate) so progress is visible.

## Step 3 — Implement

- Work inside `extension/` (create it only in story 00). Follow the module layout in
  ARCHITECTURE §2 exactly.
- Honour the repo's hard rules wherever they apply:
  - All Sheets writes are single-cell, `valueInputOption=RAW`. Never `values:append`.
  - Columns resolve by header name, never position.
  - All Voice DOM selectors live only in `src/content/selectors.ts`.
  - Call Status vocabulary matches `server/src/sheets/sheetTemplate.ts` `CHANNELS[0]` verbatim.
  - No raw hex in components — design tokens only (`tokens.css`).
  - Service-account key: `chrome.storage.local` only, never `storage.sync`.
  - A wrong sheet write is worse than a missed one — ambiguous cases pause and ask.
- Write the unit tests the story names as you go, not at the end.
- Match existing code style; comment only where the docs' hard-won constraints need stating.

## Step 4 — Verify (mechanical)

Run and make pass, from `extension/`:

```
npm run build
npm test
npm run lint
```

Fix failures — do not report done with red checks. If a check can't run yet (e.g. story 00 midway),
say so explicitly.

## Step 5 — Final quality checklist

Go through this list one item at a time and report each as ✅ / ❌ / N/A with a one-line
justification. Do not rubber-stamp: for every item, point at the file/test/command output that
proves it.

1. **Acceptance criteria** — every `- [ ]` in the story's Acceptance criteria section is
   demonstrably met (name the evidence per box). Criteria needing a live Google account/Voice
   call that you cannot perform: mark N/A and list them for the user's manual smoke test.
2. **Scope complete, nothing extra** — all Scope items done; nothing from Out of scope leaked in.
3. **Doc conformance** — spot-check the implementation against the exact ARCHITECTURE/DESIGN/UX
   sections the story cites (message shapes, token usage, layout, keyboard map).
4. **Hard rules** — grep-verify: no `values:append`, no `USER_ENTERED` outside a formula write,
   no selector strings outside `selectors.ts`, no raw hex outside `tokens.css`, no
   `storage.sync` usage for the key.
5. **Tests** — the story's named test files exist, are meaningful (assert behaviour, not
   existence), and pass.
6. **Build health** — build/test/lint all green; extension loads unpacked without manifest
   warnings when the story affects the manifest.
7. **Regression** — prior stories' tests still pass; nothing previously working was broken.
8. **TypeScript strictness** — no `any` escapes, no `@ts-ignore`/`@ts-expect-error` without a
   stated reason.

If any item is ❌, fix it and re-run the checklist before finishing.

## Step 6 — Close out

- Tick the satisfied `- [ ]` boxes in the story file (`- [x]`), leaving unverifiable ones
  unticked with a `<!-- needs manual smoke: ... -->` note.
- Final message: what shipped, checklist results table, any manual-smoke steps the user must do,
  and which story is next per the README.
- Do not commit unless the user asks.
