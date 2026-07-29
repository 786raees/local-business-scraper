# Google Voice Quick Dial

Chrome extension that turns the Google Voice web dialer into a **power dialer** driven by an
Atlas lead sheet: pick a spreadsheet tab, press Start, talk, press `1`–`8`, next call dials
itself — and every outcome lands back in the sheet's `Call Status` column.

Design docs: `../doc/CHROME_EXTENSION_PRD.md` (what & why), `_ARCHITECTURE.md` (how),
`_DESIGN.md` (look), `_UX.md` (flows). Built story-by-story per `../doc/extension_stories/`.

## Install (unpacked)

```
cd extension
npm install
npm run build
```

Then: `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select
`extension/dist`.

## Setup (once)

1. Click the toolbar icon → the side panel opens → **Open setup**.
2. Drop your Google **service-account JSON key** (the same `.google-service-account.json` the
   Atlas server uses). It validates instantly.
3. Copy the service-account email shown and **share your lead spreadsheet with it (Editor)**.
4. Sign in to https://voice.google.com in a normal tab.

## Daily use

Toolbar icon → pick spreadsheet/tab (remembered afterwards) → `▶ Start dialing` (or `Space`).
Per call: the lead card shows who's ringing; when the call ends press `1`–`8` (the sheet's
Call Status vocabulary, in order), optional note via `N`; the next call dials after a short
countdown (undo available inside it). `Esc` pauses, Stop/Stop now in the bar. Settings (pause
length, ringing timeout, default filter) live behind the gear icon.

Outcomes queue durably: offline or rate-limited writes show as "N unsynced" and retry
themselves; a 403 pauses the queue until you re-share the sheet.

## Development

- `npm run dev` — Vite + crxjs HMR build
- `npm test` — vitest (state machine, queue, sheets client, mapping, auth…)
- `npm run lint` — oxlint
- `node scripts/gen-icons.mjs` — regenerate icons

Field-tested invariants (do not break):
- All sheet writes are **single-cell** `values.update` with `valueInputOption=RAW` — never
  `values:append`, never `USER_ENTERED` (see `src/sheets/client.ts`).
- Columns resolve by **header name**, never position (`src/sheets/mapping.ts`).
- Every Google Voice DOM selector lives in `src/content/selectors.ts` only.
- Call Status vocabulary mirrors `server/src/sheets/sheetTemplate.ts` `CHANNELS[0]` verbatim.
- The service-account key stays in `chrome.storage.local` — never `storage.sync`.

Manual release checklist: `SMOKE.md`.
