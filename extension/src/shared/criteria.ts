import { CALL_STATUS_VALUES } from '../sheets/vocab'
import type {
  CallOutcome,
  DialCriteria,
  DialFilter,
  LineTypeFilter,
  NumberFilter,
} from './types'

/**
 * Dial-criteria vocabulary, defaults, sanitising, and display (story 14).
 * The evaluator lives in background/leads.ts; this module is UI/storage-safe
 * (no chrome APIs) so the options page and panel share it.
 */

export const DEFAULT_CRITERIA: DialCriteria = { status: 'uncalled' }

export const STATUS_FILTERS: readonly DialFilter[] = ['all', 'uncalled', 'retry']

export const STATUS_LABELS: Record<DialFilter, string> = {
  all: 'All rows',
  uncalled: 'Uncalled only',
  retry: 'Retry (No Answer + Callback)',
}

export const LINE_TYPE_FILTERS: readonly LineTypeFilter[] = [
  'mobile', 'landline', 'voip', 'unknown',
]

export const LINE_TYPE_LABELS: Record<LineTypeFilter, string> = {
  mobile: 'Mobile',
  landline: 'Landline',
  voip: 'VoIP',
  unknown: 'Unknown',
}

const NUMBER_BOUNDS = {
  reviewCount: { min: 0, max: 1_000_000, step: 1 },
  rating: { min: 1, max: 5, step: 0.1 },
} as const

function sanitizeNumberFilter(
  raw: NumberFilter | undefined,
  bounds: { min: number; max: number; step: number },
): NumberFilter | undefined {
  if (!raw || (raw.op !== 'lt' && raw.op !== 'gte')) return undefined
  const value = Number(raw.value)
  if (!Number.isFinite(value)) return undefined
  const clamped = Math.min(bounds.max, Math.max(bounds.min, value))
  return { op: raw.op, value: Math.round(clamped / bounds.step) * bounds.step }
}

/**
 * Clamp/drop malformed axes from stored or wire criteria. Empty multi-selects
 * collapse to undefined so "nothing ticked" reads as "any", never "none".
 */
export function sanitizeCriteria(raw: unknown): DialCriteria {
  const c = (raw ?? {}) as Partial<DialCriteria>
  const out: DialCriteria = {
    status: STATUS_FILTERS.includes(c.status as DialFilter)
      ? (c.status as DialFilter)
      : DEFAULT_CRITERIA.status,
  }
  const lineTypes = (c.lineTypes ?? []).filter((t) => LINE_TYPE_FILTERS.includes(t))
  if (lineTypes.length) out.lineTypes = lineTypes
  if (c.website === 'has' || c.website === 'none') out.website = c.website
  const reviewCount = sanitizeNumberFilter(c.reviewCount, NUMBER_BOUNDS.reviewCount)
  if (reviewCount) out.reviewCount = reviewCount
  const rating = sanitizeNumberFilter(c.rating, NUMBER_BOUNDS.rating)
  if (rating) out.rating = rating
  const stages = (c.stages ?? []).filter((s) => typeof s === 'string' && s.trim())
  if (stages.length) out.stages = stages
  const outcomes = (c.outcomes ?? []).filter((o) =>
    (CALL_STATUS_VALUES as readonly string[]).includes(o))
  if (outcomes.length) out.outcomes = outcomes as CallOutcome[]
  return out
}

export const opText = (f: NumberFilter): string =>
  `${f.op === 'lt' ? '<' : '≥'} ${f.value}`

/** One-line summary for the collapsed filter control and the options page. */
export function criteriaSummary(c: DialCriteria): string {
  const parts: string[] = [
    c.status === 'all' ? 'All rows' : c.status === 'uncalled' ? 'Uncalled' : 'Retry',
  ]
  if (c.lineTypes?.length) parts.push(c.lineTypes.map((t) => LINE_TYPE_LABELS[t]).join('/'))
  if (c.website === 'has') parts.push('Has website')
  if (c.website === 'none') parts.push('No website')
  if (c.reviewCount) parts.push(`Reviews ${opText(c.reviewCount)}`)
  if (c.rating) parts.push(`Rating ${opText(c.rating)}`)
  if (c.stages?.length) parts.push(`Stage: ${c.stages.join(', ')}`)
  if (c.outcomes?.length) parts.push(`Was: ${c.outcomes.join(', ')}`)
  return parts.join(' · ')
}
