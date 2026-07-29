# Extension user stories — Google Voice Quick Dial

Sequential, each ships a working increment. Source docs: `../CHROME_EXTENSION_PRD.md`,
`../CHROME_EXTENSION_ARCHITECTURE.md`, `../CHROME_EXTENSION_DESIGN.md`, `../CHROME_EXTENSION_UX.md`.

| # | Story | Ships |
|---|---|---|
| 00 | [Project setup](00-project-setup.md) | Loadable MV3 shell, tokens, toolchain |
| 01 | [Service-account auth](01-service-account-auth.md) | S0 setup screen + browser JWT auth |
| 02 | [Sheets client](02-sheets-client.md) | Data layer: list/read/single-cell RAW write, mapping, vocab |
| 03 | [Pickers](03-pickers.md) | S1/S2 spreadsheet & tab selection |
| 04 | [Lead loading](04-lead-loading.md) | Paged lead reads, filters, worker-restart resilience |
| 05 | [Session home](05-session-home.md) | S3 resume card, Start, start-from, filter |
| 06 | [Voice content script](06-voice-content-script.md) | Dial/hang-up/call-state on voice.google.com |
| 07 | [Session state machine](07-session-state-machine.md) | The dialing loop: stop/skip/timeout/safety valve |
| 08 | [Live call screen](08-live-call-screen.md) | S4 full lead card + state tinting |
| 09 | [Outcome screen](09-outcome-screen.md) | S5 one-keypress logging + real write-back + S6 |
| 10 | [Write queue](10-write-queue.md) | Durable, non-blocking outcome writes |
| 11 | [Polish & hardening](11-polish-and-hardening.md) | Settings, error matrix, a11y, release build |
| 12 | [Start-from lead picker](12-start-from-picker.md) | Find the starting lead by name/browse — no row numbers |
| 13 | [Line-type display](13-line-type-display.md) | Mobile/Landline/VoIP chip on lead card + picker (needs Atlas gms 05) |

Dependency shape: 00 → 01 → 02 → {03, 04} → 05; 06 is independent after 00; 07 needs 04+06;
08/09 need 07; 10 needs 09; 11 last.
