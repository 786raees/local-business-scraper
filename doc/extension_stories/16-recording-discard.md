# Story 16 — Recording keep/discard: junk calls don't leave files behind

**Ships:** after a recorded call ends, the outcome screen shows the recording with a
Discard button — deleting the file from Downloads and keeping the `🎙` line out of Notes —
plus an auto-discard for calls shorter than a configurable minimum, so instant hang-ups
never accumulate junk files.

> As a caller, when a call turns out to be a wrong number that hung up in two seconds, I
> can hit Discard (or let the minimum-duration rule do it for me) — so my Downloads folder
> holds only conversations worth replaying and my sheet only points at files that exist.

## Dependency

Needs story 15 (recording pipeline — this story only adds the deletion path and the
duration gate). Shipped.

## Design decisions (bind the implementation)

1. **Discard lives on S5 (awaiting-outcome), and undo reopens it.** The `🎙` filename
   enters the sheet only when the outcome is logged (`withRecordingNote` at enqueue time),
   so S5 is the last moment the note is still composable — discard there means simply not
   attaching the filename, no queue-entry surgery. After logging, the story-10 undo
   reopens S5 with the recording intact, so "logged too fast, now discard" is just
   undo → Discard → re-log. A discard affordance in between-calls would require mutating
   a queued entry's note — rejected as a second write-shape.
   - Consequence to preserve: the story-15 undo path currently loses the filename on
     re-log (`lastRecordingFile` consumed by the first outcome). This story fixes that as
     a prerequisite: the recording reference survives undo and is re-attached on re-log,
     because keep/discard is meaningless if undo silently drops the file reference.
2. **Deletion needs the download id — keep it.** `chrome.downloads.download()` returns an
   id that story 15 discards. The worker now tracks the whole reference:

   ```ts
   interface RecordingRef {
     file: string        // basename, what Notes would get
     downloadId: number  // for downloads.removeFile + downloads.erase
     durationMs: number  // interpreter-owned: ended-at minus callStartedAt
   }
   ```

   `WorkerState.lastRecordingFile: string` becomes `lastRecording?: RecordingRef`;
   `SessionSnapshot` gains `lastRecording?: { file: string; durationMs: number }` (no
   download id on the wire — the panel asks the worker to discard, never touches
   `chrome.downloads` itself).
3. **Discard = removeFile + erase, and failure still drops the note line.** `removeFile`
   deletes from disk, `erase` removes the Downloads-UI entry (either alone leaves a
   confusing half-state). If deletion fails (file already gone, user cleared Downloads),
   the reference is dropped anyway: a Notes line pointing at a deleted file is exactly the
   lie this story exists to prevent — err on the side of no reference.
4. **Auto-discard is a duration gate, evaluated where the duration is known.** New setting
   `recordingMinSeconds` (default `5`, `0` = keep everything, bounds 0–60). The
   interpreter already owns `callStartedAt` and stamps call end; when `stopRecording`
   resolves, a recording with `durationMs < recordingMinSeconds * 1000` is discarded
   immediately and never surfaces on S5. The offscreen document stays duration-ignorant —
   one clock (the interpreter's), no drift between what the gate measures and what the
   panel timer showed.
5. **Never delete anything the extension didn't create this call.** The only file ever
   deleted is the one whose `downloadId` came from this session's own
   `chrome.downloads.download` call. No filename-based lookups, no folder sweeps — a
   basename collision with a user's unrelated file must be undeletable by construction.

## Scope

1. **Recorder** (`src/background/recorder.ts`): `stopRecording()` returns
   `{ file, downloadId } | null` instead of the bare basename; new
   `discardRecording(downloadId)` — `removeFile` then `erase`, both awaited, errors
   swallowed per decision 3.
2. **Worker state + gate** (`src/background/state.ts`, `index.ts`):
   `lastRecording?: RecordingRef`; the `stopRecording` effect handler computes
   `durationMs` from `callStartedAt`, applies the decision-4 gate (auto-discard + no
   surface), else stores the ref; `buildSnapshot` exposes `{ file, durationMs }`. The
   undo-survival fix from decision 1: `call/outcome` stashes the consumed ref so
   `session/undo` restores it.
3. **Messages** (`shared/messages.ts`, `index.ts`): `{ kind: 'recording/discard' }` —
   valid only while a `lastRecording` exists (S5 or the undo-reopened S5); discards, clears
   the ref, broadcasts. Anything else is a no-op returning the current snapshot.
4. **Settings** (`shared/storage.ts`, `options/SettingsSection.tsx`):
   `recordingMinSeconds: number` (default 5) with `SETTINGS_BOUNDS` entry `{ min: 0,
   max: 60 }`; options row "Discard recordings shorter than (seconds, 0 = keep all)"
   shown only when recording is enabled.
5. **Outcome screen** (`sidepanel/components/ActiveCall.tsx`): when
   `snapshot.lastRecording` exists on S5, a recording strip under the outcome grid —
   `🎙 row-42_Big-Sky-Dental….webm · 0:47` (basename middle-truncated via the existing
   `truncateMiddle`, duration mm:ss) with a `Discard` button (`btn secondary`, tokens
   only). Strip disappears on discard; outcome buttons unaffected.
6. **Tests** (`test/recording.test.ts` extensions + `session.test.ts` untouched — no new
   machine transitions): duration gate boundaries (under/at/over threshold, `0` keeps
   all), discard drops the ref and the note line (`withRecordingNote` gets `undefined`),
   deletion-failure still drops the ref, undo→re-log re-attaches the surviving ref,
   `recordingMinSeconds` clamping, and the snapshot never carries `downloadId`.

## Out of scope

- Any change to the session state machine — keep/discard is interpreter + panel only.
- Discarding from between-calls or later (undo → S5 is the path); bulk cleanup of old
  recordings; retention policies.
- Removing an already-written `🎙` line from the sheet (the line is only written when the
  user kept the recording through outcome logging).
- Playback/preview of the recording in the panel.
- Per-call opt-in prompts before recording starts (recording remains session-level).

## Acceptance criteria

- [ ] S5 shows the recording strip with basename + duration for a kept recording, and
      Discard removes the file (`downloads.removeFile` + `erase`), the strip, and the `🎙`
      note line — manual smoke for the visuals/deletion, unit tests for ref-drop and note
      composition.
      <!-- needs manual smoke: strip visuals + real file deletion; ref-drop/note tests in
           recording.test.ts "recording ref lifecycle" -->
- [x] Calls shorter than `recordingMinSeconds` are auto-discarded and never surface on S5;
      `0` keeps everything (gate boundary tests).
      <!-- shouldAutoDiscard boundary tests (4999/5000ms at 5s; 0 keeps all); interpreter
           applies the gate before storing the ref -->
- [x] Undo → re-log keeps the recording reference: the re-logged outcome's note carries
      the same `🎙` line (regression test on the decision-1 fix).
      <!-- consumeRecordingForOutcome/restoreRecordingOnUndo round-trip test -->
- [x] A failed deletion still drops the reference — no Notes line ever points at a file
      the extension believes deleted.
      <!-- recording/discard clears lastRecording BEFORE the fire-and-forget delete;
           discardRecording swallows both removeFile and erase failures -->
- [x] `SessionSnapshot` exposes `{ file, durationMs }` only — snapshot wire-shape test
      asserts JSON.stringify(snap) never contains "downloadId".
- [x] `recordingMinSeconds` clamps to [0, 60] and defaults to 5 (settings test, incl. NaN).
- [x] Hard rules hold: sheet writes unchanged (single-cell RAW via the existing queue);
      no raw hex outside `tokens.css`; no selector strings outside `content/selectors.ts`.
- [x] Full suite green (`npm run build && npm test && npm run lint` in `extension/`);
      prior stories' tests untouched (166 tests, lint 0). One deliberate refinement over
      story 15: a hard-stopped call's ref is dropped but its FILE is kept (story 15's
      "no outcome ⇒ keep, write nothing") — only the duration gate and the user delete.
