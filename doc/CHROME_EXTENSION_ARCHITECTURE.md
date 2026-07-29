# Architecture — Google Voice Quick Dial (Chrome Extension)

**Status:** Draft v1
**Companion docs:** `CHROME_EXTENSION_PRD.md` (what & why) · `CHROME_EXTENSION_DESIGN.md` (UI, planned)

This document is the technical blueprint: components, module layout, message contracts, state
machines, storage schemas, the Sheets/auth ports from Atlas, and the build/test setup.

---

## 1. High-level shape

Manifest V3 extension with four runtime surfaces communicating over `chrome.runtime` messaging:

```
┌────────────────────────┐         ┌──────────────────────────────┐
│  Side Panel (React)    │◄──port──►│  Background Service Worker   │
│  pickers, lead card,   │         │  · session state machine     │
│  outcome buttons,      │         │  · Sheets/Drive REST client  │
│  session controls      │         │  · JWT auth + token cache    │
└────────────────────────┘         │  · outcome write queue       │
                                   └──────┬───────────────────────┘
┌────────────────────────┐                │ chrome.tabs.sendMessage /
│  Options Page (React)  │◄──msg──────────┤ chrome.runtime.sendMessage
│  service-account key   │                ▼
└────────────────────────┘         ┌──────────────────────────────┐
                                   │  Content Script              │
                                   │  voice.google.com only       │
                                   │  · dial(number) / hangUp()   │
                                   │  · call-state observer       │
                                   └──────────────────────────────┘
                                              │ DOM
                                              ▼
                                    Google Voice web dialer
```

**Single owner of truth:** the background service worker owns all session state and all network
I/O. The side panel is a pure view over that state (it re-hydrates on open); the content script is
a dumb actuator/sensor for the Voice DOM. This matters because MV3 service workers are killed and
restarted at will — see §8.

---

## 2. Repository / module layout

New sibling package `extension/` (does not touch `server/` or `web/`):

```
extension/
├── manifest.json
├── vite.config.ts              # @crxjs/vite-plugin, TS, React
├── package.json
├── src/
│   ├── background/
│   │   ├── index.ts            # entry: message router, alarm handlers
│   │   ├── session.ts          # DialerSession state machine (pure logic, unit-testable)
│   │   ├── writeQueue.ts       # durable outcome write queue
│   │   └── voiceController.ts  # finds/creates the Voice tab, proxies to content script
│   ├── sheets/                 # browser port of server/src/sheets/ (see §5)
│   │   ├── auth.ts             # WebCrypto JWT signing + token cache
│   │   ├── client.ts           # fetch wrapper: retry, RAW writes, single-cell updates
│   │   ├── mapping.ts          # header-name → column-index resolution
│   │   └── vocab.ts            # CALL_STATUS_VALUES — mirrors CHANNELS[0] in sheetTemplate.ts
│   ├── content/
│   │   ├── index.ts            # entry: message handlers, observer lifecycle
│   │   ├── dialer.ts           # dial(number), hangUp() against the Voice DOM
│   │   ├── callState.ts        # MutationObserver → CallState events
│   │   └── selectors.ts        # ALL Voice DOM selectors. Single source of truth.
│   ├── sidepanel/
│   │   ├── index.html / main.tsx
│   │   ├── App.tsx
│   │   ├── store.ts            # Zustand mirror of background state
│   │   └── components/         # SpreadsheetPicker, TabPicker, LeadCard, OutcomePanel, SessionBar
│   ├── options/
│   │   ├── index.html / main.tsx
│   │   └── KeySetup.tsx
│   └── shared/
│       ├── messages.ts         # every runtime message type (discriminated union)
│       ├── types.ts            # Lead, SessionState, CallState, Outcome, storage schemas
│       └── storage.ts          # typed chrome.storage.local accessors
└── test/                       # vitest: session.test.ts, mapping.test.ts, auth.test.ts, ...
```

Conventions carried over from Atlas:

- **`content/selectors.ts` is the only file that knows Voice's DOM** — the direct analogue of
  `server/src/scraper/selectors.ts`. When Google ships new markup and dialing breaks, that file is
  the fix.
- **`sheets/vocab.ts` duplicates the Call Status vocabulary by hand** (the two repos share no
  build). A comment links it to `sheetTemplate.ts`; changing one requires changing the other —
  same hand-kept-in-sync contract as Atlas's `server/src/types.ts` ↔ `web/src/lib/types.ts`.
- Session/state logic (`session.ts`, `mapping.ts`, `writeQueue.ts`) is pure TypeScript with
  injected I/O, so vitest covers it without Chrome APIs.

---

## 3. manifest.json

```jsonc
{
  "manifest_version": 3,
  "name": "Google Voice Quick Dial",
  "version": "0.1.0",
  "description": "Power dialer for Google Voice driven by an Atlas lead sheet.",
  "background": { "service_worker": "src/background/index.ts", "type": "module" },
  "side_panel": { "default_path": "src/sidepanel/index.html" },
  "options_page": "src/options/index.html",
  "action": { "default_title": "Open Quick Dial" },      // click → open side panel
  "permissions": ["sidePanel", "storage", "scripting", "tabs", "alarms"],
  "host_permissions": [
    "https://voice.google.com/*",
    "https://sheets.googleapis.com/*",
    "https://www.googleapis.com/*",
    "https://oauth2.googleapis.com/*"
  ],
  "content_scripts": [{
    "matches": ["https://voice.google.com/*"],
    "js": ["src/content/index.ts"],
    "run_at": "document_idle"
  }]
}
```

Notes:

- `alarms` powers the write-queue retry backoff and keep-alive-free scheduling (MV3 forbids
  long-lived timers in the worker).
- No `identity` permission — auth is a service account, not `chrome.identity` OAuth.
- The action button calls `chrome.sidePanel.open()`; there is no popup.

---

## 4. Shared types & message contracts

All cross-surface communication uses one discriminated union in `shared/messages.ts`. Nothing else
crosses the boundary. Representative subset:

```ts
// ── Side panel → background ─────────────────────────────────────────
type PanelToBg =
  | { kind: 'panel/hydrate' }                        // → full SessionSnapshot reply
  | { kind: 'sheets/listSpreadsheets' }
  | { kind: 'sheets/listTabs'; spreadsheetId: string }
  | { kind: 'sheets/loadLeads'; spreadsheetId: string; sheetTitle: string }
  | { kind: 'session/start'; fromRow?: number }
  | { kind: 'session/stop'; hard: boolean }          // hard=true also hangs up
  | { kind: 'session/skip' }
  | { kind: 'call/outcome'; outcome: CallOutcome; note?: string }

// ── Background → side panel (broadcast over a long-lived Port) ──────
type BgToPanel =
  | { kind: 'state'; snapshot: SessionSnapshot }     // full state on every transition

// ── Background → content script ─────────────────────────────────────
type BgToContent =
  | { kind: 'voice/dial'; phone: string }
  | { kind: 'voice/hangUp' }
  | { kind: 'voice/probe' }                          // → current CallState reply

// ── Content script → background ─────────────────────────────────────
type ContentToBg =
  | { kind: 'voice/callState'; state: CallState }    // fired on every observed change
  | { kind: 'voice/error'; reason: 'not-logged-in' | 'dialer-not-found' | 'dial-failed' }
```

Core domain types (`shared/types.ts`):

```ts
interface Lead {
  rowIndex: number          // 1-based sheet row — the lead's identity for write-back
  name: string
  phone: string             // raw, as stored by Atlas
  ownerName?: string; ownerTitle?: string
  category?: string; address?: string; website?: string
  rating?: string; reviewCount?: string
  stage?: string; callStatus?: string; notes?: string
}

type CallOutcome =
  | 'No Answer' | 'Voicemail' | 'Answered' | 'Interested'
  | 'Not Interested' | 'Callback' | 'Wrong Number' | 'DNC'

type CallState = 'idle' | 'dialing' | 'ringing' | 'in-call' | 'ended'

type SessionPhase =
  | 'setup'           // no key / not validated
  | 'pick-sheet' | 'pick-tab' | 'loading-leads'
  | 'ready'           // leads loaded, not dialing
  | 'dialing' | 'in-call'
  | 'awaiting-outcome'
  | 'between-calls'   // inter-call delay countdown
  | 'paused' | 'error'

interface SessionSnapshot {
  phase: SessionPhase
  spreadsheet?: { id: string; name: string }
  tab?: { title: string; rowCount: number }
  leads: { total: number; skippedNoPhone: number }
  cursor: number                    // index into dialable leads
  currentLead?: Lead
  callState: CallState
  unsyncedOutcomes: number
  error?: string
}
```

The side panel holds **no independent state**: its Zustand store is written only by `state`
broadcasts, and on mount it sends `panel/hydrate`. Closing/reopening the panel mid-session is
therefore lossless.

---

## 5. Sheets layer (browser port of Atlas `server/src/sheets/`)

### 5.1 `sheets/auth.ts`

Same design as Atlas's `SheetsAuth`, with two substitutions:

| Atlas (Node) | Extension (browser) |
|---|---|
| `node:crypto` `createSign('RSA-SHA256')` | `crypto.subtle.importKey('pkcs8', …, 'RSASSA-PKCS1-v1_5'/SHA-256)` + `crypto.subtle.sign` |
| key file on disk | key JSON in `chrome.storage.local` |

Details:

- The service-account `private_key` is PEM (PKCS#8). Strip header/footer/newlines, base64-decode
  to `ArrayBuffer`, import once, cache the `CryptoKey` in the worker.
- Assertion claims identical to `buildAssertion`: `iss` = client_email, `scope` = joined scopes,
  `aud` = token_uri, `iat`/`exp` = now/+3600. Base64url-encoded header/claim/signature.
- Scopes: `https://www.googleapis.com/auth/spreadsheets` +
  `https://www.googleapis.com/auth/drive.metadata.readonly`.
- Token cached with the same **refresh-60s-early** rule. Because the worker can be killed, the
  token and its expiry are also mirrored to `chrome.storage.session` so a restarted worker reuses
  a live token instead of re-exchanging.

### 5.2 `sheets/client.ts`

Direct port of `SheetsClient` (plain `fetch`, no SDK):

- Retry 3× with exponential backoff (500ms base) on `429/500/502/503/504` only. `403` (sheet not
  shared) and `401` fail fast — a retry never fixes them.
- `listSpreadsheets()` — Drive `files.list`, spreadsheet mimeType, not trashed, ordered by
  `modifiedTime desc`, `pageSize=100`.
- `getTabs(id)` — `fields=sheets.properties(sheetId,title,gridProperties.rowCount)`.
- `getValues(id, range)` — used for the header row and paged lead loading
  (`A1:Z1`, then `A2:Z1001`, `A1002:Z2001`, … until short page).
- `updateCell(id, sheetTitle, a1Cell, value)` — `values.update` on a **single-cell range** with
  `valueInputOption=RAW`. This is the only write the extension performs.

Hard rules inherited from Atlas (each learned by breaking a real sheet there):

1. **RAW always.** `USER_ENTERED` parses phone-like strings as formulas → `#ERROR!`.
2. **Single-cell writes only.** A row-width write would clobber the `Outreach` `ARRAYFORMULA`
   column. The extension never calls `values:append` at all.
3. **`403` means "share the sheet with the service account"** — surface the service-account email
   in the error UI, don't retry.

### 5.3 `sheets/mapping.ts`

Header-name resolution, mirroring Atlas's rule that **columns are matched by header, never by
position**:

- Read row 1, build `Map<lowercased header, columnIndex>`.
- Required headers: `name`, `phone`, `Call Status`. Missing any ⇒ the tab is rejected with a
  message naming what's missing (the tab probably isn't an Atlas export).
- Optional headers picked up when present: `ownerName`, `ownerTitle`, `category`, `address`,
  `website`, `rating`, `reviewCount`, `Stage`, `Notes`.
- Column index → A1 letter helper handles >26 columns (`AA`…) since Atlas tabs are 33 columns wide.
- The resolved mapping is stored on the session, so write-back computes the target cell as
  `'<tab title>'!<CallStatusLetter><rowIndex>`.

### 5.4 Lead loading & identity

- A `Lead` is built per data row; its identity is its **sheet row number** (`rowIndex`).
- Rows with empty `phone` are counted but not dialable.
- **Stale-row guard:** immediately before writing an outcome, re-read that row's `name` cell and
  compare with the loaded lead. Mismatch ⇒ the sheet was re-sorted or rows were inserted
  mid-session; the session enters `error` with "Sheet changed — reload the tab" rather than
  writing a status onto the wrong business. (Row order is the only identity available; a re-sort
  invalidates every cursor.)

---

## 6. Content script (`voice.google.com`)

### 6.1 `selectors.ts` — single source of truth

Every DOM selector for Voice lives here, nothing else in the codebase queries the Voice DOM.
Approximate initial set (to be verified against the live product during M2 — Voice ships an
Angular app with `gv-*` custom elements and `aria-label`s, both more stable than generated class
names):

```ts
export const SEL = {
  dialpadInput:   'input[aria-label*="phone number" i], gv-dialpad input',
  callButton:     'button[aria-label*="call" i]',
  inCallWidget:   'gv-in-call, [aria-label*="ongoing call" i]',
  endCallButton:  'button[aria-label*="end call" i]',
  loginMarker:    'a[href*="accounts.google.com"]',
}
```

Rules (borrowed from the Atlas scraper's field experience):

- Prefer `aria-label` regexes over class names; Google's generated classes churn weekly.
- Voice may localize labels; the extension can't force `hl=en` on an app the user is logged into,
  so state detection leans on **element presence** (`inCallWidget`, `endCallButton`) more than
  label text wherever possible.

### 6.2 `dialer.ts`

- `dial(phone)`: focus dialpad input → set value via the native setter + `input` event (Angular
  needs the event, a bare `.value=` is invisible to it) → click call button. Falls back to
  navigating to `https://voice.google.com/u/0/calls?a=nc,%2B<E164>` (Voice's "new call" deep link)
  if the dialpad isn't mounted.
- `hangUp()`: click `endCallButton` if present.
- Phone strings are passed through as Atlas stored them; Voice's own input tolerates formatting
  (`+1 305-697-3490` dials fine). No client-side normalisation in v1.

### 6.3 `callState.ts`

A `MutationObserver` on `document.body` (subtree, childList) drives a tiny state derivation:

| Observation | Derived `CallState` |
|---|---|
| dial clicked, no in-call widget yet | `dialing` |
| in-call widget present, call timer absent/00:00 | `ringing` |
| in-call widget present with running timer | `in-call` |
| widget removed after being present | `ended` |

Every derived change is sent as `voice/callState`. The observer is connected only while a session
is active (`voice/dial` connects it, `ended` + ack disconnects), so the script is inert on Voice
tabs the user browses manually.

### 6.4 Failure signals

- Dialpad/selectors not found within 5s of `voice/dial` → `voice/error: 'dialer-not-found'`.
- Page shows the signed-out marker → `voice/error: 'not-logged-in'`. The background pauses the
  session; the extension **never** types credentials.

---

## 7. Background service worker

### 7.1 `session.ts` — the state machine

Pure, synchronous transition function + an effects interpreter (so vitest can drive it without
Chrome). Phases as in §4; the happy-path cycle:

```
ready ──start──► dialing ──callState:ringing/in-call──► in-call
  ▲                 │ timeout 60s (configurable)            │ callState:ended
  │                 ▼                                       ▼
  │              auto-hangup, outcome pre-set        awaiting-outcome
  │              'No Answer'──────────────────────────────► │ user picks outcome
  │                                                         ▼
  └───────── cursor==end ◄──between-calls (delay, default 3s)──[write outcome]
```

Transition rules of note:

- `stop (soft)` from any phase ⇒ finish the current call flow (including outcome) then `paused`.
  `stop (hard)` ⇒ `hangUp()` immediately, discard to `paused`, no outcome forced.
- `skip` in `awaiting-outcome` advances without writing (explicitly allowed).
- Ringing timeout: an `alarms` alarm set at dial time; on fire in `ringing`, hang up and enter
  `awaiting-outcome` with `No Answer` pre-selected (user can still change it).
- `voice/error` and unrecoverable Sheets errors ⇒ `error` phase with a message; `start` retries
  from the current cursor.

### 7.2 `voiceController.ts`

- `ensureVoiceTab()`: find an existing `voice.google.com` tab (`chrome.tabs.query`), else
  `chrome.tabs.create` one. Never reuses the user's non-Voice active tab. Focuses the tab on dial
  so the user can talk.
- Injects the content script with `chrome.scripting.executeScript` if messaging gets no receiver
  (covers "tab existed before the extension was installed/reloaded").

### 7.3 `writeQueue.ts` — durable outcome writes

Outcomes must survive worker death and network flakiness:

1. On outcome selection, the write intent
   `{ spreadsheetId, cell, value, note?, leadName, ts }` is appended to a queue in
   `chrome.storage.local` **before** any network call.
2. A drain loop (kicked by every enqueue and by a 1-min `alarms` tick) performs the stale-row
   guard read, then the single-cell RAW update, then (if a note) the read-append-write on the
   Notes cell, then removes the entry.
3. Failures leave the entry queued; `SessionSnapshot.unsyncedOutcomes` surfaces the count and the
   panel offers manual retry. `403` marks the queue paused (retrying is pointless until sharing is
   fixed).

Dialing may continue while writes are queued — a slow Sheets API never blocks the next call.

### 7.4 MV3 lifecycle (§8 prerequisite)

- All session state that must survive worker termination — snapshot, leads array, cursor, queue —
  is checkpointed to `chrome.storage.session` (leads can be large; `storage.session` has a 10MB
  quota and dies with the browser, which is the right lifetime).
- On worker start, state is re-hydrated before the message router answers anything.
- Long-running waits (inter-call delay, ringing timeout, queue retry) use `chrome.alarms`, never
  `setTimeout` — a killed worker loses timers but alarms persist.

---

## 8. Storage schema

`chrome.storage.local` (persistent, never synced):

| Key | Value |
|---|---|
| `serviceAccountKey` | `{ client_email, private_key, token_uri }` — the pasted JSON |
| `settings` | `{ interCallDelayMs: 3000, ringingTimeoutMs: 60000, dialFilter: 'all' \| 'empty' \| 'retry' }` |
| `resume:<spreadsheetId>:<tabTitle>` | `{ cursor: number, updatedAt: string }` — per-tab resume point |
| `writeQueue` | `WriteIntent[]` (§7.3) |

`chrome.storage.session` (worker-restart resilience, browser-lifetime):

| Key | Value |
|---|---|
| `token` | `{ accessToken, expiresAt }` |
| `session` | full serialized session: snapshot + leads + mapping |

The private key **never** goes to `storage.sync` (it would replicate to every signed-in Chrome).

---

## 9. Error-handling matrix

| Failure | Detection | Behaviour |
|---|---|---|
| Key invalid / malformed | token exchange fails at setup | Options page shows the exchange error; nothing else usable |
| Sheet not shared | `403` on Drive/Sheets call | Show service-account email + "share as Editor"; no retry |
| Tab isn't an Atlas export | required headers missing | Reject tab, name the missing headers |
| Rate limit / 5xx | `429/5xx` | 3× exponential backoff (500ms base), then queue (writes) or surface (reads) |
| Voice logged out | content script marker | Pause session, prompt manual login |
| Voice markup changed | `dialer-not-found` | Pause session; fix is `content/selectors.ts` only |
| Sheet re-sorted mid-session | stale-row guard name mismatch | `error` phase: "Sheet changed — reload the tab"; no wrong-row write, ever |
| Worker killed mid-call | MV3 lifecycle | Rehydrate from `storage.session`; `voice/probe` re-syncs call state |
| Ringing forever | 60s alarm | Auto hang-up, pre-select `No Answer` |

Design constant throughout: **a wrong write is worse than a missed write.** Every ambiguous
situation resolves to pausing and asking, never to guessing a row or a value.

---

## 10. Build, tooling, testing

- **Build:** Vite + `@crxjs/vite-plugin` (HMR for panel/options, proper MV3 bundling of the worker
  and content script). TypeScript strict. React for panel/options — same stack as Atlas `web/`,
  minus the need for tanstack-table.
- **Lint:** oxlint, matching `web/`.
- **Unit tests (vitest):**
  - `session.test.ts` — every transition in §7.1, including timeout and hard-stop paths.
  - `mapping.test.ts` — reordered columns, missing headers, >26-column A1 letters.
  - `auth.test.ts` — assertion shape (header/claims decode), WebCrypto sign round-trip against the
    Node verifier.
  - `writeQueue.test.ts` — enqueue-before-network, drain, 403-pauses-queue.
  - `client.test.ts` — retry matrix with injected `fetch`, RAW enforced on every write.
- **Manual smoke:** a checked-in test spreadsheet template (Atlas export of ~10 rows) + a
  scripted walkthrough in the design doc; real calls can't be CI'd.

---

## 11. Constraints & explicit non-choices

- **No Google SDKs** (`googleapis`, gapi) — plain `fetch`, same as Atlas. Keeps the worker bundle
  tiny and the auth path auditable.
- **No backend.** The extension talks to Google APIs directly; there is no relay server, nothing
  to deploy.
- **No `chrome.identity`/OAuth consent flow in v1** — service account only, matching the Atlas
  setup the user already has. (A v2 could add OAuth so non-technical users skip key handling.)
- **No automation of Voice login** — credentials are never seen, stored, or typed.
- **Content script edits nothing but the dialer** — it does not restyle or overlay Voice; all UI
  lives in the side panel.
- **Only `Call Status` and `Notes` cells are ever written** (single-cell RAW updates). `Stage`,
  `Outreach`, and every Atlas data column are read-only.
