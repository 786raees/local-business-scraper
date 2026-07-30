import { useEffect, useMemo, useRef, useState } from 'react'
import { send } from '../api'
import {
  afterLastCalledCursor,
  firstUncalledCursor,
  searchLeads,
} from '../../background/leads'
import { OUTCOME_BUCKET } from '../../sheets/vocab'
import { LineChip } from './ActiveCall'
import type { CallOutcome, Lead, SessionSnapshot } from '../../shared/types'

const ROW_H = 44
const LIST_H = 264 // 6 rows visible
const OVERSCAN = 5

interface PickerLead
  extends Pick<Lead, 'rowIndex' | 'name' | 'phone' | 'callStatus' | 'lineType' | 'lineCarrier'> {}

interface Props {
  /** Current cursor (index into the dialable list) — browse opens here. */
  cursor: number
  resumeName?: string
  onPicked: (snapshot: SessionSnapshot) => void
  onClose: () => void
}

type Excluded = { name: string; reason: string } | null

/**
 * Story 12 — the start-from lead picker. Search by name (digits also match
 * the sheet row), browse a windowed list with status chips, or jump via
 * shortcuts. Combobox pattern: focus stays on the input; options are driven
 * by aria-activedescendant so screen readers announce name/row/status.
 */
export function StartFromPicker({ cursor, resumeName, onPicked, onClose }: Props) {
  const [leads, setLeads] = useState<PickerLead[] | null>(null)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [scrollTop, setScrollTop] = useState(0)
  const [excluded, setExcluded] = useState<Excluded>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void send<PickerLead[]>({ kind: 'leads/list' }).then((r) => {
      if (r.ok) setLeads(r.data)
    })
    inputRef.current?.focus()
  }, [])

  const browsing = query.trim() === ''
  const result = useMemo(
    () => searchLeads((leads ?? []) as Lead[], query, browsing ? Number.MAX_SAFE_INTEGER : 50),
    [leads, query, browsing],
  )
  const rows = result.matches as PickerLead[]

  // Browse mode opens at the current cursor, not row 2 (story 12 scope 4).
  useEffect(() => {
    if (!leads || !browsing) return
    const top = Math.max(0, cursor - 1) * ROW_H
    listRef.current?.scrollTo({ top })
    setScrollTop(top)
    setActive(Math.min(cursor, rows.length - 1))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leads])

  useEffect(() => { if (!browsing) setActive(0) }, [query, browsing])

  // The "filtered out" explanation on zero matches (story 12 out-of-scope rule).
  useEffect(() => {
    if (!leads || rows.length > 0 || browsing) { setExcluded(null); return }
    let stale = false
    void send<Excluded>({ kind: 'leads/searchAll', query }).then((r) => {
      if (!stale && r.ok) setExcluded(r.data)
    })
    return () => { stale = true }
  }, [rows.length, query, leads, browsing])

  async function pick(lead: PickerLead) {
    const res = await send<SessionSnapshot>({ kind: 'session/setCursor', rowIndex: lead.rowIndex })
    if (res.ok) { onPicked(res.data); onClose() }
  }

  function moveActive(delta: number) {
    const next = Math.max(0, Math.min(rows.length - 1, active + delta))
    setActive(next)
    // Keep the active option rendered and visible inside the window.
    const el = listRef.current
    if (!el) return
    const top = next * ROW_H
    if (top < el.scrollTop) el.scrollTo({ top })
    else if (top + ROW_H > el.scrollTop + LIST_H) el.scrollTo({ top: top + ROW_H - LIST_H })
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveActive(1) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveActive(-1) }
    else if (e.key === 'Enter') { e.preventDefault(); if (rows[active]) void pick(rows[active]) }
    else if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }

  if (!leads) return <div className="loading">Loading leads…</div>

  const shortcuts = buildShortcuts(leads, cursor, resumeName)

  // Manual windowing: spacer + visible slice + spacer (story 12 scope 1).
  const start = Math.max(0, Math.floor(scrollTop / ROW_H) - OVERSCAN)
  const end = Math.min(rows.length, Math.ceil((scrollTop + LIST_H) / ROW_H) + OVERSCAN)
  const visible = rows.slice(start, end)

  return (
    <div className="start-from picker">
      <input
        ref={inputRef}
        className="search"
        style={{ margin: 0 }}
        role="combobox"
        aria-expanded={rows.length > 0}
        aria-controls="picker-listbox"
        aria-activedescendant={rows[active] ? `picker-opt-${rows[active].rowIndex}` : undefined}
        aria-label="Search leads by business name or row number"
        placeholder="Type a business name (or row number)…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={onKeyDown}
      />

      <div aria-live="polite" className="row-sub">
        {browsing
          ? `${rows.length.toLocaleString()} leads`
          : `${rows.length.toLocaleString()} match${rows.length === 1 ? '' : 'es'}${
              result.more > 0 ? ` (${result.more} more — keep typing)` : ''}`}
      </div>

      {browsing && shortcuts.length > 0 && (
        <div className="picker-shortcuts">
          {shortcuts.map((s) => (
            <button
              key={s.label}
              className="btn secondary"
              title={`${s.lead.name} · row ${s.lead.rowIndex}`}
              onClick={() => void pick(s.lead)}
            >
              {s.label}
              <span className="row-sub"> {s.lead.name}</span>
            </button>
          ))}
        </div>
      )}

      {excluded && (
        <div className="row-sub bad" role="status">
          {excluded.name} is filtered out ({excluded.reason}) — change the Dial
          filter to include it.
        </div>
      )}

      <div
        ref={listRef}
        id="picker-listbox"
        role="listbox"
        aria-label="Leads"
        className="picker-list"
        style={{ height: Math.min(LIST_H, rows.length * ROW_H) }}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
      >
        <div style={{ height: start * ROW_H }} />
        {visible.map((lead, i) => {
          const index = start + i
          const bucket = lead.callStatus
            ? OUTCOME_BUCKET[lead.callStatus as CallOutcome] ?? 'neutral'
            : null
          return (
            <div
              key={lead.rowIndex}
              id={`picker-opt-${lead.rowIndex}`}
              role="option"
              aria-selected={index === active}
              className={`row picker-row${index === active ? ' selected' : ''}`}
              onMouseEnter={() => setActive(index)}
              onClick={() => void pick(lead)}
            >
              <div className="row-main">
                <div className="row-name">{lead.name}</div>
                <div className="row-sub tabular">row {lead.rowIndex} · {lead.phone}</div>
              </div>
              {bucket && (
                <span className={`status-chip chip-${bucket}`}>{lead.callStatus}</span>
              )}
              <LineChip lead={lead} />
            </div>
          )
        })}
        <div style={{ height: Math.max(0, (rows.length - end) * ROW_H) }} />
      </div>

      <div className="start-from-actions">
        <button className="icon-btn" onClick={onClose}>Cancel (Esc)</button>
      </div>
    </div>
  )
}

interface Shortcut { label: string; lead: PickerLead }

function buildShortcuts(leads: PickerLead[], cursor: number, resumeName?: string): Shortcut[] {
  const typed = leads as Lead[]
  const out: Shortcut[] = []
  const uncalled = firstUncalledCursor(typed)
  if (uncalled !== null) out.push({ label: 'First uncalled', lead: leads[uncalled] })
  const afterLast = afterLastCalledCursor(typed)
  if (afterLast !== null && afterLast !== uncalled) {
    out.push({ label: 'After last called', lead: leads[afterLast] })
  }
  if (cursor > 0 && leads[cursor] && leads[cursor].name === resumeName) {
    out.push({ label: 'Resume point', lead: leads[cursor] })
  }
  if (leads[0] && uncalled !== 0) out.push({ label: 'Top of list', lead: leads[0] })
  return out
}
