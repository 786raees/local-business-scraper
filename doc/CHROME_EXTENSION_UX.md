# UX Specification — Google Voice Quick Dial (Chrome Extension)

**Status:** Draft v1
**Companion docs:** `CHROME_EXTENSION_PRD.md` · `CHROME_EXTENSION_ARCHITECTURE.md` ·
`CHROME_EXTENSION_DESIGN.md`

This document specifies every screen and flow. The design doc says how things look; this one says
what happens, in what order, and why.

## 0. UX principles

The user's real task is a **calling session**: dozens to hundreds of calls in a sitting. Every
decision below serves four rules:

1. **The loop is the product.** Ring → talk → log → next must need at most **one click (or one
   keystroke) per call**. Everything else — setup, pickers, settings — is amortized overhead and
   may cost a few clicks once per day, never once per call.
2. **Never make the user remember.** The extension remembers the spreadsheet, the tab, the row it
   stopped at, and the settings. Reopening the panel always lands where the user left off.
3. **Never make the user wait on Google.** Sheet writes happen in the background; the next call
   never blocks on the previous call's logging.
4. **No dead ends.** Every error state names the problem *and* carries the one button that fixes
   it. If the extension can't fix it, the button says exactly what the human should do.

---

## 1. Screen map

```
                       ┌─────────────┐
   first run / no key  │  S0 Setup   │  (Options page)
                 ┌────►│  paste key  │
                 │     └──────┬──────┘
                 │            ▼
┌────────┐   ┌──┴───────────────┐   ┌──────────────────┐
│ toolbar│──►│ S1 Pick sheet    │──►│ S2 Pick tab      │
│  icon  │   │ (skipped when    │   │ (skipped when    │
└────────┘   │  remembered)     │   │  remembered)     │
             └──────────────────┘   └────────┬─────────┘
                                             ▼
                                    ┌──────────────────┐
                              ┌────►│ S3 Session home  │◄────┐
                              │     │ ready / paused   │     │
                              │     └────────┬─────────┘     │
                              │        Start ▼               │
                              │     ┌──────────────────┐     │
                              │     │ S4 Live call     │     │
                              │     │ dialing→in-call  │     │
                              │     └────────┬─────────┘     │
                              │   call ends  ▼               │
                              │     ┌──────────────────┐     │
                              │     │ S5 Outcome       │─────┘
                              │     │ 1 tap → next call│  auto-advance
                              │     └──────────────────┘
                              └── Stop / end of list
```

One screen visible at a time in the side panel. S1/S2 are skipped on every session after the
first — a returning user goes toolbar icon → S3 in one click.

---

## 2. Screens

### S0 — Setup (Options page, once ever)

Shown when no service-account key is stored. The side panel, if opened first, shows a single
card: "Connect Google Sheets → Open setup" (one button, opens Options).

Layout, top to bottom:

1. Title: **Connect your Google account** with one sentence: *"Quick Dial reads your lead sheet
   and writes call outcomes back. It uses a service account — the same one as Atlas."*
2. **Key drop zone**: drag-and-drop the `.json` key file *or* paste into a textarea. File drop is
   primary (bigger target, no clipboard fumbling).
3. On paste/drop the key is validated **immediately** (token exchange, no Save button to find):
   - ✓ *"Connected as `atlas@…iam.gserviceaccount.com`"*
   - Below it, step 2 appears: **"Share your spreadsheet with this email"** with the address in a
     copy-chip and an *"Open Google Sheets"* link. This is the step users forget; putting it
     directly under the success state, with a copy button, is the whole trick.
   - ✗ Error card with the exact exchange error and what it usually means ("This file isn't a
     service-account key — it should contain `client_email` and `private_key`").
4. Footer, muted: *"The key stays in this browser profile. Anyone using this profile can read it."*

Done here, the user never sees S0 again.

### S1 — Pick spreadsheet

- Header: **Choose spreadsheet** + gear icon.
- Search input (autofocused) over the list of spreadsheets shared with the service account,
  newest-modified first. Typing filters instantly (client-side).
- Row = name + "modified 2 days ago". Click → S2.
- Empty state (none shared): *"No spreadsheets are shared with `…gserviceaccount.com` yet"* +
  copy-email chip + Refresh button. This is a fix-it screen, not an apology.
- The previously used spreadsheet, if any, is pinned at the top under a "Recent" caption.

### S2 — Pick tab

- Header: **‹ back · <spreadsheet name>**.
- List of tabs: title + row count. Tabs that fail header validation (no `name`/`phone`/
  `Call Status`) still appear but disabled, with *"missing: Call Status"* under the name — the
  user learns why instead of wondering where their tab went.
- Click a valid tab → brief loading state ("Reading 312 leads…") → S3.

### S3 — Session home (`ready` / `paused`)

The launchpad. Everything needed to start confidently, nothing else:

1. **Context line** (header): `Leads · 312 rows`, gear icon, and a `⇄` icon to change
   sheet/tab (returns to S1 — deliberately small; changing lists is rare).
2. **Resume card** (the hero):
   - First session: *"Ready — 312 leads, 298 dialable"* (+ tooltip: "14 rows have no phone").
   - Returning: *"You stopped at row 213 — **Big Sky Dental** · Tue 4:12pm"*.
3. **Big primary button**: `▶ Start dialing` / `▶ Resume from row 213`. One click starts the
   session. This is the only prominent control on the screen.
4. **Start from…** (ghost button): expands inline to a row-number input with a live preview of
   that row's business name ("Row 250 → *Hilltop Vet Clinic*") so the user confirms by name, not
   by number. Also offers "Start from top".
5. **Filter select** (compact, remembered): `Dial: All rows ▾` / `Uncalled only` /
   `Retry (No Answer + Callback)`. Defaults to `Uncalled only` — the most common intent and the
   safest (never re-dials someone logged as DNC by accident).
6. Unsynced-writes chip appears here too if the queue is non-empty.

Starting checks the Voice tab: if none exists, one is opened and focused; if logged out, S3 shows
the fix-it banner (*"Log in to Google Voice, then press Start again"* + "Open Voice" button).

### S4 — Live call (`dialing` → `ringing` → `in-call`)

The panel becomes the lead card, full-height, nothing to operate:

1. **Call-state row** at top: pulsing dot + "Calling…" / "Ringing…" / timer `03:12` once
   connected. Header border tints amber/green (design doc §7).
2. **Lead card** (design doc §6.4): name huge, owner, phone, category, rating, address, website
   link, Stage badge, and the **history strip** — last Call Status chip + Notes. The history
   strip is what makes the user sound informed ("I see we spoke last week…"), so it sits directly
   under the facts, never behind a click.
3. **Session bar**: `Stop` (soft — finishes this call first) · `Stop now` (danger) ·
   `Skip` appears only pre-connection (skipping mid-conversation is not a thing).
4. Progress: `47 of 298 · row 213`.

No outcome buttons yet — during a live conversation the panel is read-only on purpose; nothing
the user can misclick while talking.

If ringing exceeds the timeout (default 60s): auto hang-up → S5 with **No Answer pre-selected**.

### S5 — Outcome (`awaiting-outcome`)

The moment that must be fastest. Layout:

1. Compact lead header (name + number) — one line, so context survives without stealing space.
2. **Outcome grid**, 2×4, exactly the sheet's dropdown order with number-key hints:

   | | |
   |---|---|
   | `1` No Answer | `5` Not Interested |
   | `2` Voicemail | `6` Callback |
   | `3` Answered | `7` Wrong Number |
   | `4` Interested | `8` DNC |

3. **Note field** (single line, placeholder *"Add note — optional"*): `N` focuses it; Enter
   confirms outcome + note together. Notes get date-prefixed and appended to the sheet's Notes
   cell.
4. **Next-call countdown**: on selection, a slim bar sweeps for the inter-call delay (default 3s)
   with the next lead's name shown — *"Next: Hilltop Vet Clinic"* — and two escapes:
   `Space` / click to **dial now**, `Esc` to **pause** instead. The delay is a breather and an
   undo window, not a loading state.
5. Undo: during the countdown a toast shows *"Logged **Interested** — Undo"*; undo reverts the
   queued write (it hasn't hit the sheet yet if within the delay) and returns to S5.

So the per-call cost in the common case is literally **one keypress**: `1`–`8`, countdown, next
call dials itself. Rule 1 satisfied.

Pre-selected No Answer (from timeout): the button shows filled + dashed "auto" chip; the
countdown starts immediately. Pressing any other number overrides it; doing nothing logs
No Answer. Unattended overnight sessions therefore log themselves — but see §4.3.

### S6 — End of list

*"That's the list — 298 dialed, 61 answered, 12 interested."* (counts from this session's logged
outcomes) + two buttons: `Back to leads` (S3) and `Change tab` (S2). Small, honest, done.

---

## 3. Keyboard map (active while the panel is focused)

| Key | Context | Action |
|---|---|---|
| `1`–`8` | S5 | Select outcome (order = sheet dropdown) |
| `Enter` | S5 | Confirm current selection (+ note if focused) |
| `N` | S5 | Focus note field |
| `Space` | countdown | Dial next immediately |
| `Esc` | countdown | Pause session |
| `Space` | S3 | Start / Resume |
| `E` | S4 | End call (hang up) |
| `S` | S4 pre-connection | Skip lead |
| `/` | S1 | Focus search |

Hints render as small key-caps on the buttons themselves — the map is discoverable without a help
screen.

---

## 4. Edge flows

### 4.1 Errors follow the fix-it pattern

Every error banner = one sentence naming the cause + the one action that resolves it:

| Situation | Banner | Action button |
|---|---|---|
| Voice logged out | "Google Voice is signed out." | **Open Voice** (then Resume) |
| Sheet not shared (403) | "This sheet isn't shared with the service account." | **Copy email** |
| Voice markup changed | "Can't find the dialer — Voice may have updated." | **Retry** (+ report hint) |
| Sheet re-sorted mid-session | "The sheet's rows moved — statuses could land on the wrong business." | **Reload leads** (re-reads tab, re-finds cursor by name) |
| Write failures piling up | chip: "3 unsynced" | **Retry now** (popover lists the 3 leads) |

The re-sort case deliberately *stops* dialing: a wrong write is worse than a pause (architecture
doc §9).

### 4.2 Interruptions are lossless

- Closing the side panel mid-call: the call continues (it lives in the Voice tab); reopening the
  panel re-hydrates into S4/S5 exactly where it was. If the call ended while the panel was
  closed, it reopens on S5 for that lead.
- Browser restart mid-session: resume point was persisted at the last outcome; S3 shows
  *"Resume from row N"*. At most one call's outcome is lost, and the write queue survives.

### 4.3 Auto-advance safety valve

Unattended auto-advance (timeout → No Answer → next call) stops itself after **10 consecutive
auto-logged calls** and pauses with *"10 calls unanswered in a row — paused."* This protects
against dialing an entire list into the void because the user walked away (or Voice broke in a
way the observer misread as ringing).

### 4.4 Changing lists mid-session

`⇄` in the S3/S4 header → confirm dialog if a session is active ("Pause and switch lists?").
Each tab keeps its own resume point, so switching back later resumes correctly.

---

## 5. First-session walkthrough (the whole journey, counted in clicks)

1. Install → click toolbar icon → panel shows "Connect Google Sheets" → **click 1** opens Options.
2. Drop key file (validated instantly) → copy service-account email (**click 2**) → share the
   sheet in Google Sheets (outside the extension) → back to panel.
3. **Click 3**: choose spreadsheet. **Click 4**: choose tab. ("Reading 312 leads…")
4. **Click 5**: `▶ Start dialing`. Voice tab opens, first call dials.
5. Call ends → press `3` (Answered). Countdown → next call dials itself.

Five clicks from install to first call; **one keypress per call** thereafter. Every session after
this one: toolbar icon → `Space` → dialing.
