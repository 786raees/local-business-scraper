import { describe, it, expect } from 'vitest'
import { generateKeyPairSync, createVerify } from 'node:crypto'
import { buildAssertion, SheetsAuth } from '../../src/sheets/auth.js'

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const KEY = {
  client_email: 'svc@example.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
  token_uri: 'https://oauth2.googleapis.com/token',
}

function decode(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
}

describe('buildAssertion', () => {
  it('produces a three-part JWT', () => {
    expect(buildAssertion(KEY, ['scope-a'], 1000).split('.')).toHaveLength(3)
  })

  it('sets RS256 in the header', () => {
    const [h] = buildAssertion(KEY, ['scope-a'], 1000).split('.')
    expect(decode(h)).toEqual({ alg: 'RS256', typ: 'JWT' })
  })

  it('sets issuer, audience, space-joined scopes and a one-hour expiry', () => {
    const [, c] = buildAssertion(KEY, ['scope-a', 'scope-b'], 1000).split('.')
    expect(decode(c)).toEqual({
      iss: 'svc@example.iam.gserviceaccount.com',
      scope: 'scope-a scope-b',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1000,
      exp: 4600,
    })
  })

  it('signs with the private key so the public key verifies it', () => {
    const jwt = buildAssertion(KEY, ['scope-a'], 1000)
    const [h, c, sig] = jwt.split('.')
    const ok = createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(sig, 'base64url'))
    expect(ok).toBe(true)
  })
})

describe('SheetsAuth.isConfigured', () => {
  it('is false when the key file is missing', () => {
    expect(new SheetsAuth('/nonexistent/key.json').isConfigured()).toBe(false)
  })

  it('returns an empty clientEmail when unconfigured rather than throwing', () => {
    expect(new SheetsAuth('/nonexistent/key.json').clientEmail()).toBe('')
  })
})
