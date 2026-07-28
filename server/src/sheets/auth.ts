import { createSign } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'

export interface ServiceAccountKey {
  client_email: string
  private_key: string
  token_uri: string
}

export const SHEETS_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.metadata.readonly',
]

const DEFAULT_KEY_PATH = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
  ?? '.google-service-account.json'

const b64 = (o: unknown): string =>
  Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url')

/**
 * Build the signed JWT Google exchanges for an access token. Split out from the
 * network call so it can be verified in tests without hitting Google.
 */
export function buildAssertion(key: ServiceAccountKey, scopes: string[], nowSec: number): string {
  const header = b64({ alg: 'RS256', typ: 'JWT' })
  const claim = b64({
    iss: key.client_email,
    scope: scopes.join(' '),
    aud: key.token_uri,
    iat: nowSec,
    exp: nowSec + 3600,
  })
  const unsigned = `${header}.${claim}`
  const sig = createSign('RSA-SHA256').update(unsigned).sign(key.private_key, 'base64url')
  return `${unsigned}.${sig}`
}

/** Loads the key lazily and caches the access token until shortly before expiry. */
export class SheetsAuth {
  private key: ServiceAccountKey | null = null
  private token = ''
  private expiresAt = 0

  constructor(private keyPath: string = DEFAULT_KEY_PATH) {}

  isConfigured(): boolean {
    return existsSync(this.keyPath)
  }

  /** The address a spreadsheet must be shared with. Empty when unconfigured. */
  clientEmail(): string {
    try { return this.load().client_email } catch { return '' }
  }

  private load(): ServiceAccountKey {
    if (this.key) return this.key
    if (!existsSync(this.keyPath)) {
      throw new Error(`Google service-account key not found at ${this.keyPath}`)
    }
    const parsed = JSON.parse(readFileSync(this.keyPath, 'utf8')) as ServiceAccountKey
    if (!parsed.client_email || !parsed.private_key) {
      throw new Error(`Malformed service-account key at ${this.keyPath}`)
    }
    parsed.token_uri ||= 'https://oauth2.googleapis.com/token'
    this.key = parsed
    return parsed
  }

  async getToken(): Promise<string> {
    const nowSec = Math.floor(Date.now() / 1000)
    // Refresh 60s early so a token never expires mid-request.
    if (this.token && nowSec < this.expiresAt - 60) return this.token
    const key = this.load()
    const res = await fetch(key.token_uri, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: buildAssertion(key, SHEETS_SCOPES, nowSec),
      }),
    })
    const body = await res.json() as { access_token?: string; error_description?: string }
    if (!body.access_token) {
      throw new Error(`Google token exchange failed: ${body.error_description ?? res.status}`)
    }
    this.token = body.access_token
    this.expiresAt = nowSec + 3600
    return this.token
  }
}
