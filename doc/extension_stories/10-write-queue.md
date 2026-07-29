# Story 10 — Durable write queue

**Ships:** outcomes survive anything — network failures, rate limits, worker death — without
ever blocking the next call.

> As a user, if Sheets is slow, rate-limited, or my Wi-Fi blips, my logged outcomes queue up
> visibly and sync themselves; I keep dialing — so a flaky API never costs me a logged call or a
> minute of session time.

## Scope

1. **`background/writeQueue.ts`** (ARCHITECTURE §7.3):
   - Enqueue-before-network: the write intent `{spreadsheetId, cell, value, note?, leadName, ts}`
     is persisted to `storage.local` **before** any fetch (story 09's direct write moves behind
     the queue).
   - Drain loop kicked by every enqueue + a 1-minute `chrome.alarms` tick; per entry: stale-row
     guard → Call Status write → Notes append → dequeue.
   - Transient failures keep the entry; `403` pauses the whole queue (retry is pointless until
     sharing is fixed).
   - Dialing continues regardless of queue depth.
2. **Unsynced chip** (DESIGN §6.7, UX §4.1): amber dot + "N unsynced" in the session bar and on
   S3; click → popover listing the queued leads (name, outcome, age) + "Retry now". Queue-paused
   (403) state shows the copy-email fix-it instead of Retry.
3. **Toolbar badge** (DESIGN §7): red count when unsynced > 0 and no call active.
4. **Undo integration**: story 09's undo now = removing the queue entry before drain (guaranteed
   safe while the countdown holds the entry with a not-before timestamp).
5. `writeQueue.test.ts`: enqueue-before-network ordering, drain success/partial, 403 pause,
   restart-with-pending-queue recovery, undo removal (ARCHITECTURE §10).

## Acceptance criteria

- [ ] With network blocked (devtools offline on the worker), logging 3 outcomes shows
      "3 unsynced" while dialing continues; restoring network drains all 3 correctly.
- [ ] A `429` storm retries with backoff and eventually syncs; a `403` pauses the queue with the
      sharing fix-it, and "Retry now" after re-sharing drains it.
- [x] Kill the worker with a non-empty queue → entries survive and drain on restart.
      <!-- restart-recovery proven in writeQueue.test.ts (new instance over same store drains);
           the live worker-kill run is manual -->
- [x] Stale-row guard inside the drain: a re-sorted sheet fails the entry into a visible error
      state rather than writing the wrong row.
      <!-- 'stale' path unit-tested (dropped + surfaced, never written); live re-sort is manual -->
- [x] Undo during countdown removes the entry; nothing reaches the sheet.
      <!-- remove()-before-due proven: writer never invoked -->
<!-- needs manual smoke: boxes 1–2 (offline drain, 429/403 flows) need a live network — the
     queue semantics behind them are fully unit-tested in writeQueue.test.ts. -->

## Out of scope

Remaining polish and error banners not tied to writes (story 11).
