# Story 00 — Project setup: a loadable extension shell

**Ships:** an installable MV3 extension with all four surfaces rendering, the design tokens in
place, and the test/lint toolchain running.

> As a developer, I can load the extension in Chrome and see a themed side panel, options page,
> and a background worker + content script that log they're alive — so every later story has a
> skeleton to build into.

## Scope

1. Create the `extension/` package (sibling of `server/` and `web/`) with the exact module layout
   from ARCHITECTURE §2 — directories and placeholder entry files for `background/`, `content/`,
   `sidepanel/`, `options/`, `sheets/`, `shared/`, `test/`.
2. Tooling: Vite + `@crxjs/vite-plugin`, TypeScript strict, React 18, oxlint, vitest
   (ARCHITECTURE §10). Scripts: `dev`, `build`, `test`, `lint`.
3. `manifest.json` exactly as ARCHITECTURE §3: permissions (`sidePanel`, `storage`, `scripting`,
   `tabs`, `alarms`), host permissions (voice + 3 Google API origins), side panel, options page,
   content script matched to `https://voice.google.com/*`, action button opens the side panel.
4. `src/sidepanel/tokens.css` — every token from DESIGN §2–§4 (colours, type scale, spacing,
   radii, shadow) as CSS custom properties. Bundle Inter woff2 (400/500/600/700) per DESIGN §3.
5. `shared/messages.ts` + `shared/types.ts` — the full discriminated unions and domain types from
   ARCHITECTURE §4, compiled but mostly unused yet.
6. Side panel renders a placeholder card using tokens (dark navy theme visible); options page
   renders a placeholder; background worker and content script `console.log` on load.

## Acceptance criteria

- [ ] `npm run build` produces a `dist/` that loads via chrome://extensions "Load unpacked" with
      zero manifest warnings.
- [ ] Clicking the toolbar icon opens the side panel; panel shows `--bg-app` background and Inter.
- [ ] Visiting voice.google.com logs the content-script hello; no other site injects it.
- [x] `npm test` runs (one trivial passing test), `npm run lint` passes.
- [x] No raw hex in any component file — placeholder UI uses tokens only (DESIGN §9).
<!-- needs manual smoke: the three boxes above (load unpacked, side panel theme, Voice-only
     content-script log) require a live Chrome session — see final report. -->
<!-- build note: `npm run build` produces dist/ cleanly; the "zero manifest warnings" half of
     box 1 is confirmed at chrome://extensions load time. -->

## Out of scope

Any real feature: no auth, no Sheets calls, no dialing.
