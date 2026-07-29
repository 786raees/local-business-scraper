# GMS stories — Atlas (Google Maps Scraper)

Numbered feature stories for the scraper, implemented via the `/implement-gms` skill.
Source docs: `../GMS_PRD.md`, `../GMS_ARCHITECTURE.md`, `../GMS_DESIGN.md`, `../GMS_UX.md`
(plus the repo's `CLAUDE.md`, which outranks everything).

Story format follows `../extension_stories/`: what it **ships**, a user story, a numbered
**Scope** citing doc sections, checkbox **Acceptance criteria**, an explicit
**Out of scope**. Each story ships a working, testable increment.

## Feature: phone line-type detection (stories 00–05, linear)

Classify every scraped phone as mobile/landline/voip/unknown from the offline NPA-NXX
prefix database — filterable in the UI/API, exported to CSV/Sheets. The correlated
extension story `../extension_stories/13-line-type-display.md` shows the type during calls
(blocked on story 05 here).

| # | Story | Ships |
|---|---|---|
| 00 | [Dataset & loader](00-linetype-dataset-and-loader.md) | Committed NPA-NXX snapshot, build script, lazy loader |
| 01 | [Classifier](01-linetype-classifier.md) | `classifyPhone()` — pure, total, VoIP allowlist, tested |
| 02 | [Business field & store](02-linetype-business-and-store.md) | Columns, migration, filter, sort — full checklist |
| 03 | [Pipeline & backfill](03-linetype-pipeline-and-backfill.md) | Scraper classifies every row; backfill for old DBs |
| 04 | [API & UI](04-linetype-api-and-ui.md) | `Line:` filter select + chip column in the web app |
| 05 | [Exports & polish](05-linetype-exports-and-polish.md) | CSV/Sheets columns, docs; unblocks extension story 13 |

Further backlog candidates live in `GMS_PRD.md` §5.
