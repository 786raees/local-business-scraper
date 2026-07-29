# Story 13 — Line-type display: know what you're dialing

**Ships:** Quick Dial reads the sheet's `lineType`/`lineCarrier` columns (produced by Atlas —
gms_stories 00–05) and shows a line-type chip on the lead card, in the start-from picker, and
as a session filter consideration.

> As a caller, while the phone rings I can see "📱 Mobile" or "☁️ VoIP" on the lead card — so
> I know whether a text follow-up is possible and why a number might behave oddly — and I can
> see the type when choosing where to start.

## Dependency

**Blocked on Atlas gms_stories 05** (the columns must exist in exported tabs; older tabs need
`migrate-sheet.ts --restyle`). The extension side is read-only and header-matched, so it
degrades gracefully: tabs without the columns simply show no chip.

## Scope

1. **Mapping** (`src/sheets/mapping.ts`): add `lineType` and `lineCarrier` to
   `OPTIONAL_FIELD_HEADERS`; `Lead` (shared/types.ts) gains `lineType?: string` and
   `lineCarrier?: string`; `rowToLead` picks them up. Optional means optional: tabs without
   the headers behave exactly as today (never required by `validateTab`).
2. **Lead card (S4)**: a small chip beside the Phone fact — `Mobile` / `Landline` / `VoIP`
   (nothing rendered for unknown/absent). Colours via existing tokens:
   mobile → `--state-incall` treatment, landline → neutral (`--text-secondary` outline),
   voip → `--state-ringing` treatment — text label always, per DESIGN §8 (no colour-only
   meaning). Tooltip: `"{lineCarrier} — based on original carrier assignment"`.
3. **Start-from picker (story 12 component)**: the same chip on picker rows next to the
   status chip, so "find me a mobile to try" is scannable while browsing.
4. **Outcome hint (small)**: on S5, when the just-called lead is `voip`, show a muted
   caption under the grid — "VoIP number — Wrong Number/DNC may be worth considering if it
   never connects." Informational only; no behaviour change.
5. **Vocab/consistency**: chip labels and the three recognised values live in one small
   module (`shared/lineType.ts`) — unknown strings from the sheet render nothing rather
   than a broken chip (forward-compatible with future types).
6. Tests: `mapping.test.ts` additions (headers picked up when present, absent stays
   undefined, `validateTab` unchanged); a `shared/lineType.ts` unit test (recognised values,
   unknown → null).

## Out of scope

- Filtering the dial list by line type (the Atlas-side filter + a filtered export is the
  intended path; an extension-side dial filter is a candidate v2 story).
- Writing line-type data back to the sheet (Atlas owns those columns).
- SMS features.

## Acceptance criteria

- [ ] On a tab exported after gms 05, the lead card shows the correct chip with the carrier
      tooltip during a call; unknown/blank shows nothing.
- [x] On a pre-feature tab (headers absent), everything renders exactly as before — no chip,
      no errors, `validateTab` unaffected.
      <!-- mapping tests: absent headers → undefined fields; lineTypeStyle(undefined) → null
           → LineChip renders nothing; validateTab requirements unchanged -->
- [ ] Picker rows show the chip beside the status chip.
- [ ] VoIP hint caption appears on S5 only for voip leads.
- [x] Unit tests: mapping pickup/absence + label module; full suite green
      (`npm test` in `extension/` — 121 tests).
- [x] Grep: chip colours via tokens only (color-mix over --state-* vars); no raw hex outside
      `tokens.css` + the documented shared/colors.ts badge mirror.
<!-- needs manual smoke: boxes 1/3/4 are visual — dial from a tab exported (or --restyled)
     after gms 05 and check the chip + tooltip on the lead card, the picker rows, and the
     VoIP hint under the outcome grid. -->
