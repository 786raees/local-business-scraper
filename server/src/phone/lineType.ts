import { lookup as dbLookup } from './npanxxDb.js'
import type { PrefixRecord } from './npanxxDb.js'

/**
 * Line-type classification — the single source of truth for its rules (the
 * selectors.ts analogue for this feature: when a number classifies wrongly,
 * this file is the fix). Pure and total: any string in, never throws.
 *
 * Caveat carried everywhere this data surfaces: the snapshot records the
 * prefix's ORIGINAL carrier assignment; ported numbers may differ.
 */

export type LineType = 'mobile' | 'landline' | 'voip' | 'unknown'

export interface LineInfo {
  lineType: LineType
  lineCarrier: string
}

const UNKNOWN: LineInfo = { lineType: 'unknown', lineCarrier: '' }

/**
 * Wireline blocks held by these carriers overwhelmingly serve VoIP platforms
 * (Google Voice, RingCentral, Twilio numbers, …). Case-insensitive substring
 * match on the carrier name — a missed carrier is a one-line fix here.
 */
export const VOIP_CARRIERS = [
  'BANDWIDTH',
  'ONVOY',
  'INTELIQUENT',
  'SINCH',
  'LEVEL 3',
  'CENTURYLINK COMMUNICATIONS', // Level 3's successor name on many blocks
  'TWILIO',
  'PEERLESS',
  'VONAGE',
  'TELNYX',
  'PLIVO',
  'IPIFONY',
  'MAGICJACK',
  'YMAX',
  'COMMIO',
  '365 WIRELESS',
]

/**
 * Digits of a NANP number, or null when the input isn't one. Accepts
 * `+1XXXXXXXXXX`, `1XXXXXXXXXX`, and bare 10-digit forms with any punctuation;
 * everything else (short, long, other country codes) is null — Atlas scrapes
 * internationally, and non-NANP numbers are never guessed.
 */
function nanpDigits(raw: string): string | null {
  const digits = raw.replace(/\D/g, '')
  // A leading 1 is the NANP country code; a `+` followed by anything else is
  // another country entirely (the + itself is stripped with the non-digits,
  // so reject explicit non-+1 country codes before that information is lost).
  if (/^\s*\+(?!1)/.test(raw)) return null
  if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1)
  if (digits.length === 10) return digits
  return null
}

export function classifyPhone(
  raw: string,
  lookup: (prefix: string) => PrefixRecord | undefined = dbLookup,
): LineInfo {
  if (typeof raw !== 'string' || !raw.trim()) return UNKNOWN
  const digits = nanpDigits(raw)
  if (!digits) return UNKNOWN

  const record = lookup(digits.slice(0, 6))
  if (!record) return UNKNOWN

  const [type, carrier] = record
  if (type === 1) return { lineType: 'mobile', lineCarrier: carrier }
  const upper = carrier.toUpperCase()
  const voip = VOIP_CARRIERS.some((name) => upper.includes(name))
  return { lineType: voip ? 'voip' : 'landline', lineCarrier: carrier }
}
