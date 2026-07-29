# Story 00 — Line type: NPA-NXX dataset & loader

**Feature:** phone line-type detection (PRD §5) — classify every scraped phone as
`mobile` / `landline` / `voip` / `unknown` from the public North American NPA-NXX prefix
database: offline, free, instant. This story ships the data foundation.

> As a developer, `npanxxDb.lookup('305697')` returns that prefix's type + carrier from a
> committed, reviewable snapshot — no credentials, no downloads, no runtime network.

## Feature spec carried by this story

- Dataset file: `server/data/npanxx.json.gz`. Shape after gunzip:
  `Record<prefix6, [t: 0|1, carrier: string]>` (`0=wireline, 1=wireless`). Keep the data
  dumb — VoIP is derived later (story 01) from carrier names, not stored.
- Target: whole `.gz` under ~1.5 MB (~180k prefixes; tuple + numeric enum keeps it small).
- **Committed to the repo** so `npm install && npm run dev` needs nothing external.

## Scope

1. **`server/scripts/build-linetype-db.ts`** + `npm run linetype:build`: fetches a public
   NANPA/FCC-derived NPA-NXX export (document the exact source URL, licence, and date in the
   script header and in the generated file's metadata), parses, writes the snapshot, prints
   record count + source date. If the best source needs registration, use the best freely
   fetchable mirror — the committed snapshot is the deliverable, not the fetch path.
2. **Commit the snapshot.**
3. **`server/src/phone/npanxxDb.ts`**: `lookup(prefix: string): [0 | 1, string] | undefined`.
   Gunzip + parse **lazily on first call**, memoized — importing the module does zero I/O.
   Missing/corrupt file → one console warning, then behave as an empty map: this feature
   must never block scraping.
4. Tests (`server/test/lineType.test.ts` seed): loader memoization (parse once),
   missing-file degradation, lookups against a tiny injected fixture map — tests never load
   the real snapshot.

## Acceptance criteria

- [x] `npm run linetype:build` regenerates the snapshot and prints source + date + count.
      <!-- built 2026-07-29: 389/389 NPAs, 0 failures, 197,876 prefixes. Sources verified
           live: NANPA npa_report.csv (in-service US/CA geographic NPAs) +
           localcallingguide.com xmlprefix.php whose company-type field flags wireless (W)
           directly — better than the planned carrier-name heuristics -->
- [x] Snapshot committed, under size target; spot-check of 3 known prefixes (one wireless,
      one wireline ILEC, one CLEC) returns sensible carrier strings.
      <!-- 810 KB gzipped; 201207→Verizon Wireless (1), 305200→BellSouth (0),
           305697→Bandwidth.com CLEC (0, story 01's VoIP allowlist target);
           distribution 59,275 wireless / 138,601 wireline -->
- [x] Importing `npanxxDb.ts` does no I/O until the first `lookup()`.
- [x] With the data file deleted, every `lookup()` returns undefined and warns once.
      <!-- tested via the LINETYPE_DB_PATH env seam -->
- [x] `npm test` green in `server/` without network or the real snapshot.

## Out of scope

Type mapping / VoIP heuristics (01). Any `Business` or store change (02).
