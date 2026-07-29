# PRD — Google Voice Quick Dial (Chrome Extension)

**Status:** Draft v1
**Owner:** Waqar Khan
**Related project:** Atlas (Google Maps scraper) — this extension consumes the lead tabs Atlas exports to Google Sheets.

---

## 1. Overview

Google Voice Quick Dial turns the Google Voice web dialer (`voice.google.com`) into a **power dialer** driven by a Google Sheet of leads. The sheet is one produced by Atlas's Sheets export (see `server/src/sheets/sheetTemplate.ts` — the single source of truth for the tab layout).

The user picks a spreadsheet and a tab, presses **Start**, and the extension dials leads one after another. While a call is ringing it shows the lead's business info pulled from the sheet. When the call ends, the user picks an outcome (the same vocabulary as the sheet's **Call Status** dropdown) and the extension writes it back to that lead's row before advancing to the next number.

### Goals
- Zero copy-paste dialing: sheet row → dialed call → outcome logged, in one loop.
- Reuse the Atlas sheet as the single CRM surface — no separate database.
- Never corrupt the sheet: respect its dropdown vocabulary, formulas, and column order.

### Non-goals (v1)
- SMS sending, call recording, or transcripts.
- Multi-user / team dialing.
- Editing any sheet column other than `Call Status` (and optionally `Notes`).
- OAuth user-consent flow — v1 uses a service account, same as Atlas.

---

## 2. Background: the Atlas sheet contract

Everything below is already implemented in the Atlas repo and must be treated as the contract:

- **Tab layout** (`TEMPLATE_HEADERS`): `name`, then the CRM block
  `Stage | Call Status | SMS Status | FB Status | IG Status | LI Status | Outreach | Priority | Notes`,
  then the remaining Atlas fields: `ownerName, ownerTitle, address, phone, website, email, rating,
  reviewCount, priceLevel, category, hours, facebook, instagram, twitter, linkedin, youtube, tiktok,
  yelp, yellowpages, ownerSource, mapsUrl, keyword, location`.
- **Columns are matched by header name, never by position.** A user may have reordered or inserted
  columns; the extension must read row 1 and build a header→index map (mirrors
  `server/src/sheets/mapping.ts`).
- **Call Status vocabulary** (from `CHANNELS[0]` in `sheetTemplate.ts`, and enforced by a strict
  `ONE_OF_LIST` data validation on the column):
  `No Answer · Voicemail · Answered · Interested · Not Interested · Callback · Wrong Number · DNC`
- **All writes use `valueInputOption=RAW`.** `USER_ENTERED` turns phone-like strings into `#ERROR!`
  formulas (this has bitten Atlas before). The extension only writes status strings, but the rule
  stands: RAW always.
- **Never write to the `Outreach` column.** It holds a whole-column `ARRAYFORMULA`; a cell-targeted
  `values:update` on the Call Status cell only is safe, a full-row write is not. The extension must
  update **single cells by A1 range** (e.g. `Leads!C42`), never whole rows.
- **Auth:** service-account JSON key → self-signed RS256 JWT → token exchange
  (`server/src/sheets/auth.ts`). Scopes: `spreadsheets` + `drive.metadata.readonly`.
  Only spreadsheets **shared with the service-account email** are listable via Drive.

---

## 3. User flows

### 3.1 Setup (first run)
1. User opens the extension's Options page and pastes/uploads the **service-account JSON key**
   (the same `.google-service-account.json` Atlas uses). Stored in `chrome.storage.local`.
2. Options page shows the service-account email with a copy button and the hint
   *"Share your spreadsheet with this address (Editor)."*
3. Extension validates the key by performing a token exchange; shows ✓/✗.

### 3.2 Selecting the lead list
1. Side panel shows a **Spreadsheet picker**: Drive list of spreadsheets shared with the service
   account (`files.list`, mimeType spreadsheet, ordered by modifiedTime — same query as
   `SheetsClient.listSpreadsheets`).
2. On selection, a **Tab picker** lists the spreadsheet's tabs with row counts
   (`sheets.properties(sheetId,title,gridProperties.rowCount)`).
3. On tab selection the extension loads the header row, validates that `name`, `phone`, and
   `Call Status` headers exist, and reads the lead rows (paged `values.get`). Rows with an empty
   `phone` are skipped and shown as "unskippable — no number" in the queue count.

### 3.3 Dialing session
Controls in the side panel:

| Control | Behaviour |
|---|---|
| **Start** | Begins dialing from the current position. |
| **Stop** | Halts after the current call ends (and a hard "Stop now" that hangs up immediately). |
| **Start from** | Row-number input / row list so the user can resume mid-sheet (e.g. "start from row 213"). Default resume point is persisted per tab in `chrome.storage.local`. |
| **Skip** | Advance to the next lead without logging an outcome. |

Optional session filters (v1.1): only dial rows whose `Call Status` is empty, or equals
`No Answer` / `Callback`.

### 3.4 Per-call loop
1. Extension ensures a `voice.google.com` tab is open (opens one if not) and injects the content
   script.
2. Content script types the lead's `phone` into the Voice dialer and clicks **Call**.
3. **While ringing / connected**, the side panel shows the lead card:
   `name`, `ownerName` + `ownerTitle`, `category`, `address`, `rating (reviewCount)`, `website`,
   current `Stage`, previous `Call Status`, and `Notes`. This is the "who am I talking to" screen.
4. Content script detects call end (dialer UI returns to idle / "Call ended" state).
5. Side panel switches to the **Outcome screen**: eight buttons, one per Call Status value
   (`No Answer`, `Voicemail`, `Answered`, `Interested`, `Not Interested`, `Callback`, `Wrong
   Number`, `DNC`), plus an optional free-text note appended to the `Notes` cell.
6. On selection, the extension writes the outcome to that row's **Call Status cell only**
   (`values.update`, A1 single-cell range, RAW) and advances. A retry with backoff mirrors
   `SheetsClient` (retry 429/5xx up to 3×, never retry 403).
7. Configurable inter-call delay (default 3s) before dialing the next lead.

### 3.5 Failure handling
- **Sheet write fails after retries:** outcome is queued locally and flagged in the UI
  ("1 unsynced outcome — retry"); dialing may continue. Queue flushes on next success.
- **Google Voice not logged in / no dialer:** pause the session and prompt the user to log in
  (never automate credentials).
- **Row conflict:** before writing, re-read the row's `name` and confirm it matches what was loaded;
  if the sheet was re-sorted mid-session, pause and ask the user to reload the tab. (Row order is
  the identity — sorting mid-session breaks it.)

---

## 4. Architecture

Manifest V3.

| Component | Responsibility |
|---|---|
| **Side panel** (`chrome.sidePanel`) | All UI: pickers, lead card, outcome buttons, session controls. Stays visible next to the Voice tab. |
| **Background service worker** | Session state machine, Sheets/Drive REST calls, token cache, outcome write queue. |
| **Content script** (`voice.google.com`) | Dial a number, hang up, detect call state (idle → dialing → ringing → in-call → ended) by observing the dialer DOM. All Voice selectors live in one `selectors.ts` module (same rule as Atlas's `scraper/selectors.ts`) so a Google markup change is a one-file fix. |
| **Options page** | Service-account key management. |

### Auth module
Port of `server/src/sheets/auth.ts` to the browser: `crypto.subtle.importKey`
(PKCS#8) + `sign("RSASSA-PKCS1-v1_5" / SHA-256)` replaces `node:crypto.createSign`. Token cached
in the service worker with the same 60s-early refresh. No Google SDK — plain `fetch` against
`sheets.googleapis.com/v4` and `www.googleapis.com/drive/v3`, exactly like `SheetsClient`.

### Permissions (manifest)
- `sidePanel`, `storage`, `scripting`, `tabs`
- Host permissions: `https://voice.google.com/*`, `https://sheets.googleapis.com/*`,
  `https://www.googleapis.com/*`, `https://oauth2.googleapis.com/*`

### Call-state detection
MutationObserver on the Voice in-call widget. States derived from the widget's presence and its
button set (e.g. "End call" button visible ⇒ in-call; widget gone ⇒ ended). A hard timeout
(configurable, default 60s ringing) auto-hangs-up and pre-selects `No Answer`.

---

## 5. Data written by the extension

| Sheet column | When | Value |
|---|---|---|
| `Call Status` | User picks an outcome | One of the 8 vocabulary values, verbatim (strict validation would reject anything else). |
| `Notes` (optional) | User typed a note | Appended to the existing cell content with a `YYYY-MM-DD: ` prefix. |

Nothing else. `Stage`, `Outreach`, and all Atlas data columns are read-only to the extension.

---

## 6. Security notes

- The service-account private key sits in `chrome.storage.local` — acceptable for a single-user
  internal tool, but the Options page must warn that anyone with access to the browser profile can
  read it. Do not sync it (`storage.local`, never `storage.sync`).
- The extension never sees or types Google account credentials; Voice login is the user's own
  session.
- Scope is minimal: `spreadsheets` + `drive.metadata.readonly` (list-only Drive access).

---

## 7. Milestones

1. **M1 — Sheets plumbing:** options page, browser-side JWT auth, spreadsheet/tab pickers, lead
   loading with header mapping.
2. **M2 — Manual dialer:** lead card + "Dial" button per lead, content-script dialing on Voice,
   single-cell Call Status write-back.
3. **M3 — Power dialer:** Start/Stop/Start-from session loop, call-state detection, outcome screen,
   inter-call delay, unsynced-outcome queue.
4. **M4 — Polish:** resume persistence, status filters, ringing timeout, notes appending.

## 8. Open questions

- Should `Stage` auto-advance to `Contacted` on the first logged call outcome? (Atlas treats Stage
  and channel statuses as orthogonal — default **no**.)
- Support multiple phone columns / fallback numbers per lead?
- Should `Callback` outcomes capture a callback date into `Notes`?
