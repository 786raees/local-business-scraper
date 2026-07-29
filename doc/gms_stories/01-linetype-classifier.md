# Story 01 — Line type: classifier

**Ships:** `classifyPhone()` — the single source of truth for line-type rules (the
`selectors.ts` analogue for this feature: when classification is wrong, this file is the fix).

> As a developer, any phone string Atlas ever scraped — `+1 305-697-3490`, `(305) 697 3490`,
> `020 7946 0958`, garbage — classifies to a `LineInfo` without ever throwing.

## Feature spec carried by this story

```ts
// server/src/phone/lineType.ts
export type LineType = 'mobile' | 'landline' | 'voip' | 'unknown'
export interface LineInfo { lineType: LineType; lineCarrier: string }
export function classifyPhone(raw: string): LineInfo   // pure, total
```

- Normalize: digits only; accept `+1XXXXXXXXXX` / `1XXXXXXXXXX` / bare 10 digits. Anything
  else — short, long, non-+1 — is `{ lineType: 'unknown', lineCarrier: '' }`. Atlas scrapes
  internationally; non-NANP numbers are never guessed.
- Lookup `digits.slice(0, 6)` via `npanxxDb` (story 00); miss → `unknown`.
- Map: wireless → `mobile`; wireline → `landline` **unless** the carrier matches the VoIP
  allowlist → `voip`.
- **VoIP allowlist** lives in this file: case-insensitive substring matches for
  VoIP-serving CLECs (Bandwidth, Onvoy/Inteliquent, Level 3, Twilio, Peerless, …) — a plain
  exported array so a missed carrier is a one-line, unit-tested fix.
- Carrier passes through verbatim (display/export data, not a key).
- Performance: one map lookup after a regex strip — well under 1ms/row.

## Scope

1. Implement `lineType.ts` per the spec, with the db lookup injectable (test seam).
2. **`server/test/lineType.test.ts`**: normalization matrix (all accepted formats of one
   number → identical result; non-NANP/`+44…`/empty/letters → `unknown`), wireless/wireline
   mapping, VoIP allowlist hit + near-miss stays `landline`, unknown-prefix miss, and a
   never-throws sweep over pathological inputs.

## Acceptance criteria

- [x] All accepted NANP formats of the same number produce identical `LineInfo`.
- [x] Non-NANP and malformed inputs → `unknown`/`''`, no throw, no warning spam.
      <!-- incl. explicit non-+1 country codes (+44/+49), which must be rejected BEFORE
           digit-stripping erases the country-code information -->
- [x] VoIP allowlist reclassifies matching wireline carriers; others stay `landline`.
      <!-- verified against the real snapshot too: 305-697-3490 → voip (BANDWIDTH.COM CLEC) -->
- [x] Tests use injected mini-maps only; `npm test` green in `server/` (239 tests).
<!-- perf (informal, real snapshot incl. first-load): 100k classifications in 39ms —
      ~0.0004ms/row, far under the 1ms/row target -->

## Out of scope

`Business`/store changes (02), pipeline wiring (03).
