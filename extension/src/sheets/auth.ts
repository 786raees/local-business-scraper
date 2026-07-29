/**
 * Service-account auth — browser port of Atlas server/src/sheets/auth.ts
 * (ARCHITECTURE §5.1). node:crypto createSign is replaced by WebCrypto
 * RSASSA-PKCS1-v1_5 / SHA-256; the key file on disk by chrome.storage.local.
 */

export interface ServiceAccountKey {
  client_email: string
  private_key: string
  token_uri: string
}

export const SHEETS_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
]

/** Parse + validate pasted key JSON. Throws with a user-explainable message. */
export function parseServiceAccountKey(json: string): ServiceAccountKey {
  let parsed: Partial<ServiceAccountKey>
  try {
    parsed = JSON.parse(json) as Partial<ServiceAccountKey>
  } catch {
    throw new Error('Not valid JSON.')
  }
  if (!parsed.client_email || !parsed.private_key) {
    throw new Error(
      "This file isn't a service-account key — it should contain client_email and private_key.",
    )
  }
  return {
    client_email: parsed.client_email,
    private_key: parsed.private_key,
    token_uri: parsed.token_uri || 'https://oauth2.googleapis.com/token',
  }
}

const b64url = (bytes: ArrayBuffer | string): string => {
  const bin = typeof bytes === 'string'
    ? bytes
    : String.fromCharCode(...new Uint8Array(bytes))
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const b64urlJson = (o: unknown): string => b64url(JSON.stringify(o))

/** PEM (PKCS#8) → CryptoKey for RSASSA-PKCS1-v1_5 / SHA-256 signing. */
export async function importPrivateKey(pem: string): Promise<CryptoKey> {
  const body = pem
    .replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '')
  const der = Uint8Array.from(atob(body), (c) => c.charCodeAt(0))
  return crypto.subtle.importKey(
    'pkcs8',
    der.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  )
}

/**
 * Build the signed JWT Google exchanges for an access token. Claims are
 * identical to Atlas's buildAssertion; split out so tests can verify the
 * signature without hitting Google.
 */
export async function buildAssertion(
  key: ServiceAccountKey,
  scopes: string[],
  nowSec: number,
): Promise<string> {
  const header = b64urlJson({ alg: 'RS256', typ: 'JWT' })
  const claim = b64urlJson({
    iss: key.client_email,
    scope: scopes.join(' '),
    aud: key.token_uri,
    iat: nowSec,
    exp: nowSec + 3600,
  })
  const unsigned = `${header}.${claim}`
  const cryptoKey = await importPrivateKey(key.private_key)
  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    cryptoKey,
    new TextEncoder().encode(unsigned),
  )
  return `${unsigned}.${b64url(sig)}`
}

export interface CachedToken {
  accessToken: string
  /** Unix seconds. */
  expiresAt: number
}

/** Where the live token is mirrored so a restarted worker reuses it (ARCHITECTURE §5.1). */
export interface TokenStore {
  load(): Promise<CachedToken | null>
  save(token: CachedToken): Promise<void>
}

/** Performs one live token exchange; used both by getToken and key validation (S0). */
export async function exchangeToken(
  key: ServiceAccountKey,
  nowSec: number,
  // Bound — an unbound fetch throws "Illegal invocation" when called indirectly.
  fetchImpl: typeof fetch = fetch.bind(globalThis),
): Promise<CachedToken> {
  const res = await fetchImpl(key.token_uri, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: await buildAssertion(key, SHEETS_SCOPES, nowSec),
    }),
  })
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string
    error_description?: string
    error?: string
  }
  if (!body.access_token) {
    throw new Error(
      `Google token exchange failed: ${body.error_description ?? body.error ?? res.status}`,
    )
  }
  return { accessToken: body.access_token, expiresAt: nowSec + 3600 }
}

/** Caches the access token until shortly before expiry, mirrored via TokenStore. */
export class SheetsAuth {
  private token: CachedToken | null = null

  constructor(
    private loadKey: () => Promise<ServiceAccountKey | null>,
    private store: TokenStore | null = null,
    private fetchImpl: typeof fetch = fetch.bind(globalThis),
    private nowMs: () => number = () => Date.now(),
  ) {}

  async getToken(): Promise<string> {
    const nowSec = Math.floor(this.nowMs() / 1000)
    // Refresh 60s early so a token never expires mid-request.
    const live = (t: CachedToken | null): t is CachedToken =>
      t !== null && nowSec < t.expiresAt - 60

    if (live(this.token)) return this.token.accessToken
    if (this.store) {
      const mirrored = await this.store.load()
      if (live(mirrored)) {
        this.token = mirrored
        return mirrored.accessToken
      }
    }
    const key = await this.loadKey()
    if (!key) throw new Error('No service-account key configured.')
    this.token = await exchangeToken(key, nowSec, this.fetchImpl)
    await this.store?.save(this.token)
    return this.token.accessToken
  }
}
