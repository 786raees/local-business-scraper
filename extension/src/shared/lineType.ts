/**
 * Line-type display vocabulary (story 13). Values come from Atlas's offline
 * NPA-NXX classification; unrecognised strings render nothing rather than a
 * broken chip, so future types degrade gracefully.
 */

export interface LineTypeStyle {
  label: string
  /** CSS class suffix — styles live in panel.css, tokens only. */
  kind: 'mobile' | 'landline' | 'voip'
}

const STYLES: Record<string, LineTypeStyle> = {
  mobile: { label: 'Mobile', kind: 'mobile' },
  landline: { label: 'Landline', kind: 'landline' },
  voip: { label: 'VoIP', kind: 'voip' },
}

/** null for unknown/blank/unrecognised — the caller renders nothing. */
export function lineTypeStyle(value: string | undefined): LineTypeStyle | null {
  if (!value) return null
  return STYLES[value.trim().toLowerCase()] ?? null
}

export const LINE_TYPE_CAVEAT = 'based on original carrier assignment — ported numbers may differ'

export function lineTypeTooltip(carrier: string | undefined): string {
  return carrier?.trim() ? `${carrier.trim()} — ${LINE_TYPE_CAVEAT}` : LINE_TYPE_CAVEAT
}
