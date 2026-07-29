# Story 07 — Session state machine: the dialing loop

**Ships:** Start actually dials through the list — sequential calls with stop/skip/timeout —
even if the in-call UI is still minimal.

> As a user, I press Start and the extension calls my leads one after another, I can stop softly
> or immediately, skip a lead, and a dead ring gives up after 60 seconds — so the power-dialer
> loop exists end to end.

## Scope

1. **`background/session.ts`** (ARCHITECTURE §7.1): pure transition function + effects
   interpreter for the full phase cycle
   `ready → dialing → in-call → awaiting-outcome → between-calls → dialing …` with `paused`,
   `error`, and cursor-at-end → S6.
   - `stop soft`: finish current call flow (incl. outcome) then pause. `stop hard`: hangUp now,
     pause, no outcome forced.
   - `skip`: advance without writing (allowed pre-connection and in awaiting-outcome).
   - Ringing timeout via `chrome.alarms` set at dial time (default 60s): auto hang-up →
     awaiting-outcome with `No Answer` pre-selected.
   - Inter-call delay via alarm (default 3s), `between-calls` phase.
   - `voice/error` → `error` phase; Start retries from cursor.
2. **MV3 resilience** (ARCHITECTURE §7.4): every transition checkpoints to `storage.session`;
   worker restart rehydrates and `voice/probe`s the content script to re-sync call state.
3. **Resume point**: on each logged/skipped lead, persist `resume:<sheet>:<tab>` cursor
   (consumed by story 05's card).
4. **Auto-advance safety valve** (UX §4.3): 10 consecutive auto-logged (timeout) calls → pause
   with the "10 calls unanswered in a row" message.
5. **Session bar becomes real** (DESIGN §6.1): Stop (secondary) + Stop now (danger) while
   active, Skip pre-connection, live progress `X of Y · row N`.
6. **Interim screens**: minimal S4 (name + state dot + timer) and minimal S5 (outcome buttons
   fire `call/outcome` but write-back may stub to console until story 09) — enough to drive the
   loop; the full screens are stories 08/09.
7. `session.test.ts`: every transition, timeout path, hard/soft stop, safety valve, end-of-list,
   rehydration from a checkpoint (ARCHITECTURE §10).

## Acceptance criteria

- [ ] Start on a 5-row test tab dials all 5 sequentially with the delay between; end shows the
      end-of-list phase.
- [ ] Soft stop finishes the current call and pauses; Stop now hangs up immediately; Resume
      continues from the cursor.
- [ ] Unanswered call auto-hangs-up at the timeout and pre-selects No Answer.
- [x] 10 straight timeouts pause the session with the safety-valve message.
      <!-- reduce-level proof in session.test.ts (valve + manual-outcome reset) -->
- [ ] Killing the worker mid-`between-calls` and reopening the panel continues correctly.
- [x] `session.test.ts` covers the full matrix and passes.
<!-- needs manual smoke: boxes 1–3 and 5 are live dialing-loop behaviours (5-row run,
     soft/hard stop, timeout auto-hangup, worker-kill resume) — the transition logic behind
     each is reduce-tested; verify live per the /implement 07 report. Note: the 3s inter-call
     delay uses a worker setTimeout, not chrome.alarms (30s alarm floor) — a worker killed
     mid-delay resumes via the between-calls rehydration path. -->

## Out of scope

Full lead card (08), real outcome write-back (09), durable queue (10).
