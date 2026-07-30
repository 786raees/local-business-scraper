# Story 15 — Call recording: keep the conversation, not just the outcome

**Ships:** opt-in recording of each dialed call, saved to the user's Downloads as a
deterministically-named audio file, with the filename logged into the lead's Notes cell so
every sheet row points at its recording.

> As a caller, I can turn on recording and every call is saved locally as
> `Miami/row-42_Big-Sky-Dental_2026-07-30T14-05.webm` — and the row's Notes cell gains that
> filename — so when a lead says "you promised X" three weeks later, I can find and replay
> exactly that call from the sheet.

## Dependency

Needs stories 07 (session machine — recording starts/stops on call transitions), 09/10
(outcome + write queue — the filename rides the existing Notes write), 11 (settings). All
shipped.

## Design decisions (bind the implementation)

1. **"Attach in sheet" means a reference, not a file.** Sheets cells cannot hold
   attachments, and the service account cannot own Drive uploads (Google removed
   service-account storage quota; uploading needs a Shared Drive or user OAuth — both v2).
   v1 therefore writes the recording **filename** into the row's Notes cell via the
   existing `notesAppend` path. Pretending to "attach" by uploading somewhere the user
   can't see would be worse than the honest local file + pointer.
2. **Recording is OFF by default and gated by an explicit consent acknowledgement.** Call
   recording is regulated (many jurisdictions require all-party consent). The settings
   toggle only enables after the user ticks "I am responsible for complying with call
   recording laws in my jurisdiction" — stored as `recordingConsentAt: string` (ISO). The
   extension never plays a beep or announces recording; that stays the user's obligation,
   and the settings copy says so. No consent timestamp ⇒ recording code paths are inert.
3. **Capture runs in an offscreen document, mixed from two streams.** MV3 workers cannot
   touch media APIs. A `chrome.offscreen` document (reasons: `USER_MEDIA`) receives a
   `chrome.tabCapture.getMediaStreamId` for the Voice tab (remote party audio) and a
   `getUserMedia` mic stream (the caller), mixes them with WebAudio into one
   `MediaRecorder` (audio/webm;codecs=opus). Capturing only the tab would silently record
   half the conversation — the mix is mandatory, and a mic-permission denial surfaces as a
   visible session banner, never a silent tab-only recording.
   - Trap: `tabCapture` mutes the captured tab by default — the stream must be routed back
     to the audio output (`AudioContext.destination`) or the user goes deaf mid-call.
4. **Recording brackets the call, keyed to session-machine transitions, and failure never
   blocks dialing.** Start on the `dialing → in-call` transition (a new `'startRecording'`
   effect beside `'setRingingAlarm'` in `session.ts`), stop on `awaiting-outcome` /
   `stopHard` (`'stopRecording'`). Every recording effect is fire-and-forget like `'dial'`:
   a capture error marks the call "not recorded" in the panel and the session continues —
   a lost recording is recoverable, a stalled dialing session is not.
5. **Deterministic filenames, saved via `chrome.downloads`, no new storage system.** The
   file goes straight to `Downloads/gv-quick-dial/<tab title>/row-<rowIndex>_<slugified
   name>_<ISO timestamp>.webm` using `chrome.downloads.download` with a Blob URL —
   Downloads is user-visible and user-managed, unlike OPFS/IndexedDB blobs that die with
   the profile. The same string (minus the folder) is what `notesAppend` writes, so file
   and sheet can never disagree. Slugify strips path-hostile characters (`/\:*?"<>|`).
6. **The Notes write rides the existing outcome entry — no new write shape.** The sheet
   contract stays "only Call Status and Notes cells, single-cell RAW" (PRD §5). When the
   user logs the outcome, the recording filename is appended to the note the outcome
   already carries (`🎙 <filename>` on its own line). Skipped calls (no outcome logged)
   keep the local file but write nothing — a wrong/unwanted write is worse than a missed
   one. Undo (story 10's `notBefore` window) automatically covers the filename too, since
   it lives in the same queue entry.

## Scope

1. **Manifest + offscreen document** (`manifest.json`, `src/offscreen/`): add
   `tabCapture`, `offscreen`, `downloads` permissions; `src/offscreen/index.html` +
   `recorder.ts` — stream acquisition, WebAudio mix (with playback loopback per decision
   3), MediaRecorder lifecycle, Blob → object URL handed to the worker for download.
2. **Recorder controller** (`src/background/recorder.ts`): creates/reuses the offscreen
   document, resolves the Voice tab's `getMediaStreamId`, `start(lead)` / `stop()` →
   filename, error taxonomy (`mic-denied`, `capture-failed`, `save-failed`). Pure
   filename/slug logic (`recordingFileName(tabTitle, lead, ts)`) exported for tests.
3. **Session machine** (`src/background/session.ts` + `index.ts`): new effects
   `'startRecording'` / `'stopRecording'` emitted on the transitions in decision 4;
   interpreter wires them to the controller only when settings enable recording;
   `SessionSnapshot` gains `recording?: 'on' | 'off' | 'failed'` for the panel indicator.
4. **Settings** (`src/shared/storage.ts`, `src/options/SettingsSection.tsx`):
   `recordingEnabled: boolean` (default false) + `recordingConsentAt?: string`; the
   options UI implements the consent gate copy from decision 2; `clampSettings` forces
   `recordingEnabled: false` whenever consent is absent.
5. **Outcome plumbing** (`src/background/index.ts`, `outcomes.ts`): the `call/outcome`
   handler appends `🎙 <filename>` to the entry's note when the just-ended call produced a
   recording; messages/types updated (`shared/messages.ts`, `shared/types.ts`).
6. **Panel indicator** (`src/sidepanel/components/ActiveCall.tsx`): a small `● REC` chip
   on the state line while recording (tokens only — reuse the `--state-*` treatment), and
   a non-blocking "Mic blocked — call not recorded" line on `failed`.
7. **Tests**: `test/recording.test.ts` — filename determinism + slug edge cases (quotes,
   slashes, long names), consent gate (`clampSettings` forces off without consent), session
   effects fire on exactly the decision-4 transitions (extend `session.test.ts` matrix),
   note composition includes the filename only when a recording exists, and skip/undo paths
   leave the sheet untouched. Media capture itself is manual-smoke (real tab + mic).

## Out of scope

- Uploading recordings to Drive and writing a link column — v2, and it requires either a
  Shared Drive the service account can write to or a user-OAuth flow (decision 1).
- A new sheet column (`Recording`): the write contract stays Call Status + Notes only.
- Playback UI inside the extension; transcription; retention/cleanup policies (the user
  manages their Downloads folder).
- Recording announcements/beeps or per-call consent capture from the remote party.
- SMS/voicemail-drop features.

## Acceptance criteria

- [ ] With recording enabled and consent given, a completed call produces a webm in
      `Downloads/gv-quick-dial/<tab>/` whose name matches `recordingFileName` — manual
      smoke (real call), backed by the filename unit tests.
      <!-- needs manual smoke: real call with recording enabled; filename determinism +
           slug edge cases covered in recording.test.ts -->
- [x] The logged outcome's Notes append contains `🎙 <filename>` for the recorded call and
      nothing recording-related for skipped/unrecorded calls (note-composition tests).
      <!-- withRecordingNote tests; skip path clears lastRecordingFile in dispatch;
           stopHard race guarded (file only claimed in awaiting-outcome) -->
- [x] Recording is inert without the consent acknowledgement: `clampSettings` test proves
      `recordingEnabled` cannot persist true with `recordingConsentAt` absent, and the
      toggle is disabled in the options UI until ticked.
      <!-- recording.test.ts consent-gate describe; SettingsSection disabled={!consentAt} -->
- [x] `'startRecording'`/`'stopRecording'` effects fire on exactly the dialing→in-call,
      →awaiting-outcome, and stopHard transitions (+ voiceError-from-in-call cleanup) —
      session.test.ts matrix extended, all prior transitions unchanged.
- [x] A capture failure (mic denied) shows the panel notice, sets
      `recording: 'failed'`, and the session dials on — both recording effects are
      fire-and-forget in runEffect; failure only flips the flag and broadcasts.
      <!-- interpreter path is .then(ok, fail) — no await, no throw reaches dispatch;
           visual notice needs manual smoke (deny mic) -->
- [ ] Tab audio remains audible to the caller while captured (decision 3 loopback) —
      manual smoke.
      <!-- needs manual smoke: loopback wired in offscreen/recorder.ts (tabSrc →
           ctx.destination) but only a real call proves audio -->
- [x] Hard rules hold: greps show no `values:append`, no new selector strings outside
      `content/selectors.ts`, no raw hex outside `tokens.css`, key never in
      `storage.sync`; the only sheet writes remain the existing single-cell RAW ones.
- [x] Full suite green (`npm run build && npm test && npm run lint` in `extension/`);
      prior stories' tests untouched or updated with cause (158 tests, lint 0; the built
      offscreen page lands at dist/src/offscreen/index.html, matching createDocument's URL).
