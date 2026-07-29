# Story 01 — Service-account auth & setup screen (S0)

**Ships:** the once-ever setup flow — paste/drop a service-account key, get a validated Google
API token in the browser.

> As a user, I can drop my service-account JSON into the options page and immediately see
> "Connected as `…iam.gserviceaccount.com`" plus the email I must share my sheet with — so the
> extension can talk to Google on my behalf.

## Scope

1. **`sheets/auth.ts`** — browser port of Atlas `server/src/sheets/auth.ts` (ARCHITECTURE §5.1):
   - PEM PKCS#8 → `crypto.subtle.importKey` → `RSASSA-PKCS1-v1_5`/SHA-256 sign.
   - `buildAssertion` claims identical to Atlas (`iss`, `scope`, `aud`, `iat`, `exp` +3600).
   - Scopes: `spreadsheets` + `drive.metadata.readonly`.
   - Token cache with refresh-60s-early, mirrored to `chrome.storage.session` so a restarted
     worker reuses a live token.
2. **Storage** (`shared/storage.ts`): typed accessors; `serviceAccountKey` in
   `chrome.storage.local`, never `storage.sync` (ARCHITECTURE §8).
3. **Options page S0** per UX §2/S0 and DESIGN §6.6:
   - Drop zone (primary) + paste textarea (monospace 12px) for the key JSON.
   - Validation on drop/paste — no Save button: parse → require `client_email` + `private_key`
     → live token exchange.
   - Success state: "Connected as <email>" + step 2 card: copy-chip with the email, "Open Google
     Sheets" link, share instruction.
   - Error state: exact exchange error + plain-language hint (UX S0.3).
   - Footer privacy note about the key living in the browser profile.
4. **Side panel gate**: with no key stored, panel shows the single "Connect Google Sheets →
   Open setup" card (UX S0).
5. Remove key (danger button) clears storage and returns options to the empty state.

## Acceptance criteria

- [ ] Dropping the real Atlas `.google-service-account.json` shows Connected + the email chip;
      copy button puts the email on the clipboard.
- [ ] A malformed file shows the "isn't a service-account key" error; a valid-shaped key with a
      bad private key shows Google's exchange error.
- [x] `auth.test.ts`: assertion header/claims decode correctly; WebCrypto signature verifies with
      Node's `crypto.verify` against the same key (ARCHITECTURE §10).
- [x] Token is fetched once and reused until <60s to expiry (assert via injected clock/fetch).
- [x] Key present in `chrome.storage.local` only; nothing written to `storage.sync`.
<!-- needs manual smoke: real-key drop/copy-chip, malformed-key error rendering, and the panel
     connect-card toggle require a live Chrome + the real Atlas key — see /implement 01 report. -->
- [ ] Panel shows the connect card when keyless, and stops showing it once a key validates.

## Out of scope

Drive/Sheets data calls (story 02). Any picker UI.
