import { describe, expect, it } from 'vitest'
import { createVerify, generateKeyPairSync } from 'node:crypto'
import {
  SHEETS_SCOPES,
  SheetsAuth,
  buildAssertion,
  exchangeToken,
  parseServiceAccountKey,
} from '../src/sheets/auth'
import type { CachedToken, ServiceAccountKey, TokenStore } from '../src/sheets/auth'

const { publicKey, privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
})

const KEY: ServiceAccountKey = {
  client_email: 'atlas@test-project.iam.gserviceaccount.com',
  private_key: privateKey,
  token_uri: 'https://oauth2.googleapis.com/token',
}

const decode = (part: string): Record<string, unknown> =>
  JSON.parse(Buffer.from(part, 'base64url').toString('utf8')) as Record<string, unknown>

describe('parseServiceAccountKey', () => {
  it('rejects non-JSON', () => {
    expect(() => parseServiceAccountKey('not json')).toThrow('Not valid JSON')
  })

  it('rejects JSON without client_email/private_key', () => {
    expect(() => parseServiceAccountKey('{"type":"service_account"}'))
      .toThrow(/isn't a service-account key/)
  })

  it('defaults token_uri when absent', () => {
    const parsed = parseServiceAccountKey(
      JSON.stringify({ client_email: 'a@b.c', private_key: 'pem' }),
    )
    expect(parsed.token_uri).toBe('https://oauth2.googleapis.com/token')
  })
})

describe('buildAssertion', () => {
  it('encodes the exact Atlas claim set and a verifiable RS256 signature', async () => {
    const nowSec = 1_700_000_000
    const jwt = await buildAssertion(KEY, SHEETS_SCOPES, nowSec)
    const [header, claim, sig] = jwt.split('.')

    expect(decode(header)).toEqual({ alg: 'RS256', typ: 'JWT' })
    expect(decode(claim)).toEqual({
      iss: KEY.client_email,
      scope: SHEETS_SCOPES.join(' '),
      aud: KEY.token_uri,
      iat: nowSec,
      exp: nowSec + 3600,
    })

    // WebCrypto-signed, node:crypto-verified — proves cross-compat with Atlas's signer.
    const verified = createVerify('RSA-SHA256')
      .update(`${header}.${claim}`)
      .verify(publicKey, Buffer.from(sig, 'base64url'))
    expect(verified).toBe(true)
  })
})

class FakeStore implements TokenStore {
  token: CachedToken | null = null
  async load() { return this.token }
  async save(t: CachedToken) { this.token = t }
}

function fakeExchangeFetch(counter: { calls: number }): typeof fetch {
  return (async () => {
    counter.calls++
    return {
      json: async () => ({ access_token: `tok-${counter.calls}` }),
    } as Response
  }) as typeof fetch
}

describe('SheetsAuth token cache', () => {
  it('exchanges once and reuses the token until <60s to expiry', async () => {
    const counter = { calls: 0 }
    let nowMs = 1_700_000_000_000
    const auth = new SheetsAuth(
      async () => KEY, new FakeStore(), fakeExchangeFetch(counter), () => nowMs,
    )

    expect(await auth.getToken()).toBe('tok-1')
    nowMs += 3_500_000 // t+3500s — still >60s before the 3600s expiry
    expect(await auth.getToken()).toBe('tok-1')
    expect(counter.calls).toBe(1)

    nowMs += 41_000 // t+3541s — inside the 60s early-refresh window
    expect(await auth.getToken()).toBe('tok-2')
    expect(counter.calls).toBe(2)
  })

  it('reuses a live token mirrored in the store (worker-restart path)', async () => {
    const counter = { calls: 0 }
    const store = new FakeStore()
    store.token = { accessToken: 'mirrored', expiresAt: 1_700_000_000 + 3600 }
    const auth = new SheetsAuth(
      async () => KEY, store, fakeExchangeFetch(counter), () => 1_700_000_000_000,
    )

    expect(await auth.getToken()).toBe('mirrored')
    expect(counter.calls).toBe(0)
  })

  it('throws a named error when no key is configured', async () => {
    const auth = new SheetsAuth(async () => null, null, fakeExchangeFetch({ calls: 0 }))
    await expect(auth.getToken()).rejects.toThrow('No service-account key configured')
  })
})

describe('exchangeToken', () => {
  it('surfaces Google error_description on failure', async () => {
    const failFetch = (async () => ({
      status: 400,
      json: async () => ({ error: 'invalid_grant', error_description: 'Invalid JWT Signature.' }),
    })) as unknown as typeof fetch
    await expect(exchangeToken(KEY, 1_700_000_000, failFetch))
      .rejects.toThrow('Invalid JWT Signature.')
  })
})
