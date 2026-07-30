import { useEffect, useState } from 'react'
import { send } from '../api'
import {
  DEFAULT_CRITERIA,
  LINE_TYPE_FILTERS,
  LINE_TYPE_LABELS,
  STATUS_FILTERS,
  STATUS_LABELS,
  criteriaSummary,
} from '../../shared/criteria'
import type {
  BlankExclusions,
  CallOutcome,
  DialCriteria,
  DialFilter,
  LineTypeFilter,
  NumberFilter,
  SessionSnapshot,
} from '../../shared/types'

interface Props {
  criteria: DialCriteria
  dialable: number
  excludedBlank?: BlankExclusions
  onChanged: (snapshot: SessionSnapshot) => void
}

interface Vocab {
  stages: string[]
  outcomes: string[]
}

/**
 * Story 14 — the composable dial filter (S3): a collapsed one-line summary
 * with the live matching count, expanding to the full criteria panel. Every
 * change goes through session/setCriteria — the background is the only
 * evaluator, so the count, picker, and session always agree.
 */
export function DialFilterPanel({ criteria, dialable, excludedBlank, onChanged }: Props) {
  const [open, setOpen] = useState(false)
  const [vocab, setVocab] = useState<Vocab | null>(null)

  useEffect(() => {
    if (!open || vocab) return
    void send<Vocab>({ kind: 'leads/vocab' }).then((r) => { if (r.ok) setVocab(r.data) })
  }, [open, vocab])

  async function apply(next: DialCriteria) {
    const res = await send<SessionSnapshot>({ kind: 'session/setCriteria', criteria: next })
    if (res.ok) onChanged(res.data)
  }

  const patch = (p: Partial<DialCriteria>) => void apply({ ...criteria, ...p })

  /** Toggle a value in a multi-select axis; empty selections collapse to "any". */
  function toggle<T>(list: T[] | undefined, value: T): T[] | undefined {
    const cur = list ?? []
    const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value]
    return next.length ? next : undefined
  }

  const blankNotes: string[] = []
  if (excludedBlank?.rating) blankNotes.push(`${excludedBlank.rating} have no rating`)
  if (excludedBlank?.reviewCount) {
    blankNotes.push(`${excludedBlank.reviewCount} have no review count`)
  }
  if (excludedBlank?.lineType) blankNotes.push(`${excludedBlank.lineType} have no line type`)

  return (
    <div className="filter-block">
      <button
        className="filter-summary"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="section-caption" style={{ padding: 0 }}>Dial</span>
        <span className="filter-summary-text">{criteriaSummary(criteria)}</span>
        <span className="row-sub tabular">{dialable.toLocaleString()} match</span>
        <span aria-hidden="true">{open ? '▾' : '▸'}</span>
      </button>

      {open && (
        <div className="filter-panel">
          <fieldset className="crit-row">
            <legend className="crit-label">Status</legend>
            {STATUS_FILTERS.map((s: DialFilter) => (
              <label key={s} className="crit-radio">
                <input
                  type="radio"
                  name="dial-status"
                  checked={criteria.status === s}
                  onChange={() => patch({ status: s })}
                />
                {STATUS_LABELS[s]}
              </label>
            ))}
          </fieldset>

          <div className="crit-row">
            <span className="crit-label" id="crit-line-label">Line type</span>
            <div className="chip-row" role="group" aria-labelledby="crit-line-label">
              {LINE_TYPE_FILTERS.map((t: LineTypeFilter) => (
                <button
                  key={t}
                  className={`chip-toggle line-chip line-${t}`}
                  aria-pressed={criteria.lineTypes?.includes(t) ?? false}
                  onClick={() => patch({ lineTypes: toggle(criteria.lineTypes, t) })}
                >
                  {LINE_TYPE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          <label className="crit-row">
            <span className="crit-label">Website</span>
            <select
              className="filter-select"
              value={criteria.website ?? 'any'}
              onChange={(e) => patch({
                website: e.target.value === 'any'
                  ? undefined
                  : (e.target.value as 'has' | 'none'),
              })}
            >
              <option value="any">Any</option>
              <option value="has">Has a website</option>
              <option value="none">No website</option>
            </select>
          </label>

          <NumberRow
            label="Reviews"
            filter={criteria.reviewCount}
            defaultValue={20}
            min={0}
            step={1}
            onChange={(f) => patch({ reviewCount: f })}
          />
          <NumberRow
            label="Rating"
            filter={criteria.rating}
            defaultValue={4}
            min={1}
            max={5}
            step={0.1}
            onChange={(f) => patch({ rating: f })}
          />

          {vocab && vocab.stages.length > 0 && (
            <CheckList
              label="Stage"
              options={vocab.stages}
              selected={criteria.stages}
              onChange={(v) => patch({ stages: toggle(criteria.stages, v) })}
            />
          )}
          {vocab && (
            <CheckList
              label="Was"
              options={vocab.outcomes}
              selected={criteria.outcomes}
              onChange={(v) => patch({
                outcomes: toggle(criteria.outcomes, v as CallOutcome),
              })}
            />
          )}

          {blankNotes.length > 0 && (
            <div className="row-sub" role="note">
              Excluded for blank data: {blankNotes.join(' · ')}.
            </div>
          )}

          <div className="start-from-actions">
            <button className="icon-btn" onClick={() => void apply(DEFAULT_CRITERIA)}>
              Reset
            </button>
            <button className="icon-btn" onClick={() => setOpen(false)}>Done</button>
          </div>
        </div>
      )}
    </div>
  )
}

function NumberRow({ label, filter, defaultValue, min, max, step, onChange }: {
  label: string
  filter?: NumberFilter
  defaultValue: number
  min: number
  max?: number
  step: number
  onChange: (f: NumberFilter | undefined) => void
}) {
  return (
    <div className="crit-row">
      <span className="crit-label">{label}</span>
      <select
        className="filter-select"
        style={{ flex: '0 0 auto', width: 88 }}
        aria-label={`${label} comparison`}
        value={filter?.op ?? 'any'}
        onChange={(e) => onChange(
          e.target.value === 'any'
            ? undefined
            : { op: e.target.value as 'lt' | 'gte', value: filter?.value ?? defaultValue },
        )}
      >
        <option value="any">Any</option>
        <option value="lt">&lt;</option>
        <option value="gte">≥</option>
      </select>
      {filter && (
        <input
          className="filter-select num-input"
          type="number"
          aria-label={`${label} value`}
          min={min}
          max={max}
          step={step}
          value={filter.value}
          onChange={(e) => {
            const n = Number(e.target.value)
            if (Number.isFinite(n)) onChange({ ...filter, value: n })
          }}
        />
      )}
    </div>
  )
}

function CheckList({ label, options, selected, onChange }: {
  label: string
  options: string[]
  selected?: string[]
  onChange: (value: string) => void
}) {
  return (
    <fieldset className="crit-row crit-checklist">
      <legend className="crit-label">{label}</legend>
      <div className="check-list">
        {options.map((o) => (
          <label key={o} className="crit-radio">
            <input
              type="checkbox"
              checked={selected?.includes(o) ?? false}
              onChange={() => onChange(o)}
            />
            {o}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
