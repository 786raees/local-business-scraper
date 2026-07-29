import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useStore } from '../lib/store'
import { api } from '../lib/api'
import { useResults } from '../hooks/useResults'
import type { Business, ResultQuery } from '../lib/types'
import { SOCIAL_FIELDS } from '../lib/types'

const ROW_H = 40
const GRID = '36px minmax(150px,1.3fr) minmax(120px,1fr) minmax(95px,0.8fr) minmax(160px,1.4fr) 130px 90px 60px minmax(150px,1.1fr) minmax(140px,1fr)'

type Col = { key: keyof Business; label: string; sortable: boolean }
const COLS: Col[] = [
  { key: 'name', label: 'Name', sortable: true },
  { key: 'ownerName', label: 'Owner', sortable: true },
  { key: 'category', label: 'Category', sortable: true },
  { key: 'address', label: 'Address', sortable: true },
  { key: 'phone', label: 'Phone', sortable: true },
  { key: 'lineType', label: 'Line', sortable: true },
  { key: 'rating', label: 'Rating', sortable: true },
  { key: 'email', label: 'Email', sortable: true },
  { key: 'facebook', label: 'Socials', sortable: false },
]

const LINE_TYPES = [
  { label: 'Line: All', value: '' }, { label: 'Mobile', value: 'mobile' },
  { label: 'Landline', value: 'landline' }, { label: 'VoIP', value: 'voip' },
  { label: 'Unknown', value: 'unknown' },
]

const RATINGS = [
  { label: 'Any rating', value: 0 }, { label: '3.0+', value: 3 },
  { label: '3.5+', value: 3.5 }, { label: '4.0+', value: 4 }, { label: '4.5+', value: 4.5 },
]

export function ResultsTable() {
  const liveTotal = useStore((s) => s.total)
  const selected = useStore((s) => s.selected)
  const lastClickedIndex = useStore((s) => s.lastClickedIndex)
  const toggleOne = useStore((s) => s.toggleOne)
  const setSelected = useStore((s) => s.setSelected)
  const clearSelection = useStore((s) => s.clearSelection)

  const [text, setText] = useState({ q: '', category: '' })
  const [debText, setDebText] = useState(text)
  const [flags, setFlags] = useState({ minRating: 0, minReviews: 0, hasEmail: false, hasWebsite: false, hasPhone: false, lineType: '' })
  const [sort, setSort] = useState<{ by?: string; dir: 'asc' | 'desc' }>({ dir: 'asc' })

  useEffect(() => {
    const id = setTimeout(() => setDebText({ q: text.q.trim(), category: text.category.trim() }), 300)
    return () => clearTimeout(id)
  }, [text])

  const query: ResultQuery = useMemo(() => ({
    q: debText.q || undefined,
    category: debText.category || undefined,
    minRating: flags.minRating || undefined,
    minReviews: flags.minReviews || undefined,
    hasEmail: flags.hasEmail || undefined,
    hasWebsite: flags.hasWebsite || undefined,
    hasPhone: flags.hasPhone || undefined,
    lineType: flags.lineType || undefined,
    sortBy: sort.by,
    sortDir: sort.dir,
  }), [debText, flags, sort])

  const { total, getRow } = useResults(query, liveTotal)

  // Publish the live query so the CSV export link matches the visible view.
  const setResultQuery = useStore((s) => s.setResultQuery)
  useEffect(() => { setResultQuery(query) }, [query, setResultQuery])

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: total,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  })

  const toggleSort = (col: Col) => {
    if (!col.sortable) return
    setSort((s) => s.by === col.key
      ? { by: col.key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { by: col.key, dir: 'asc' })
  }

  // Checkbox click. Shift extends from the last-clicked row: the id range is fetched
  // from the server in display order, so it works across rows not yet loaded by the
  // virtualizer.
  const onRowCheck = async (row: Business, index: number, e: React.MouseEvent) => {
    if (e.shiftKey && lastClickedIndex !== null && lastClickedIndex !== index) {
      const lo = Math.min(lastClickedIndex, index)
      const ids = await api.getResultIds(lo, Math.abs(index - lastClickedIndex) + 1, query)
      // Whole range takes the clicked checkbox's new state.
      setSelected(ids, !selected.has(row.placeId), index)
    } else {
      toggleOne(row.placeId, index)
    }
  }

  const onHeaderCheck = async () => {
    if (selected.size > 0) { clearSelection(); return }
    if (!total) return
    setSelected(await api.getResultIds(0, Math.min(total, 50000), query), true)
  }

  const filtersActive = !!(debText.q || debText.category || flags.minRating || flags.minReviews
    || flags.hasEmail || flags.hasWebsite || flags.hasPhone || flags.lineType)
  const clearFilters = () => {
    setText({ q: '', category: '' }); setDebText({ q: '', category: '' })
    setFlags({ minRating: 0, minReviews: 0, hasEmail: false, hasWebsite: false, hasPhone: false, lineType: '' })
    setSort({ dir: 'asc' })
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden p-5">
      {/* filter bar */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <input value={text.q} onChange={(e) => setText((t) => ({ ...t, q: e.target.value }))}
          placeholder="Search name, address, phone, email…" className="field max-w-xs" />
        <input value={text.category} onChange={(e) => setText((t) => ({ ...t, category: e.target.value }))}
          placeholder="Category" className="field w-36" />
        <select value={flags.minRating} onChange={(e) => setFlags((f) => ({ ...f, minRating: Number(e.target.value) }))}
          className="field w-32 cursor-pointer">
          {RATINGS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        <input type="number" min={0} value={flags.minReviews || ''} placeholder="Min reviews"
          onChange={(e) => setFlags((f) => ({ ...f, minReviews: Number(e.target.value) || 0 }))}
          className="field w-28 font-mono" />
        <FilterChip on={flags.hasEmail} onClick={() => setFlags((f) => ({ ...f, hasEmail: !f.hasEmail }))}>Has email</FilterChip>
        <FilterChip on={flags.hasWebsite} onClick={() => setFlags((f) => ({ ...f, hasWebsite: !f.hasWebsite }))}>Has website</FilterChip>
        <FilterChip on={flags.hasPhone} onClick={() => setFlags((f) => ({ ...f, hasPhone: !f.hasPhone }))}>Has phone</FilterChip>
        <select value={flags.lineType} aria-label="Filter by line type"
          onChange={(e) => setFlags((f) => ({ ...f, lineType: e.target.value }))}
          className="field w-32 cursor-pointer">
          {LINE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        {filtersActive && (
          <button onClick={clearFilters} className="text-xs text-muted underline-offset-2 hover:text-rose hover:underline">
            Clear filters
          </button>
        )}
        <span className="ml-auto font-mono text-xs text-muted">
          <span className="text-teal">{total.toLocaleString()}</span> rows
        </span>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden rounded-lg border border-line">
        {/* header */}
        <div className="grid shrink-0 border-b border-line bg-ink-900/95 font-mono text-[10px] uppercase tracking-wider text-muted"
          style={{ gridTemplateColumns: GRID }}>
          <div className="flex items-center justify-center py-2.5">
            <input
              type="checkbox"
              aria-label="Select all rows"
              checked={total > 0 && selected.size >= total}
              ref={(el) => { if (el) el.indeterminate = selected.size > 0 && selected.size < total }}
              onChange={onHeaderCheck}
              className="h-3.5 w-3.5 cursor-pointer accent-[#FF6B3D]"
            />
          </div>
          {COLS.map((c) => (
            <button key={c.key} onClick={() => toggleSort(c)} disabled={!c.sortable}
              className={`flex items-center gap-1 px-3 py-2.5 text-left ${c.sortable ? 'hover:text-parchment' : 'cursor-default'}`}>
              {c.label}
              {sort.by === c.key && <span className="text-survey">{sort.dir === 'asc' ? '▲' : '▼'}</span>}
            </button>
          ))}
        </div>

        {/* virtual body */}
        <div ref={scrollRef} className="relative flex-1 overflow-auto">
          {total === 0 ? (
            <EmptyState filtered={filtersActive} />
          ) : (
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map((vi) => {
                const row = getRow(vi.index)
                return (
                  <div key={vi.key}
                    className="absolute left-0 top-0 grid w-full items-center border-b border-line/50 text-sm hover:bg-ink-600/40"
                    style={{ height: ROW_H, transform: `translateY(${vi.start}px)`, gridTemplateColumns: GRID }}>
                    {row ? (
                      <>
                        <div className="flex items-center justify-center">
                          <input
                            type="checkbox"
                            aria-label={`Select ${row.name}`}
                            checked={selected.has(row.placeId)}
                            onClick={(e) => { e.preventDefault(); void onRowCheck(row, vi.index, e) }}
                            onChange={() => {}}
                            className="h-3.5 w-3.5 cursor-pointer accent-[#FF6B3D]"
                          />
                        </div>
                        <Cells row={row} />
                      </>
                    ) : <Skeleton />}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function FilterChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`rounded-md border px-2.5 py-1.5 text-xs transition ${on
        ? 'border-survey bg-survey/15 text-survey'
        : 'border-line text-muted hover:text-parchment'}`}>
      {children}
    </button>
  )
}

function Cells({ row }: { row: Business }) {
  return (
    <>
      <Cell className="text-parchment">
        {row.website
          ? <a href={row.website} target="_blank" rel="noreferrer" className="text-parchment hover:text-teal hover:underline">{row.name}</a>
          : row.name}
      </Cell>
      <Cell>
        {row.ownerName
          ? <span className="text-parchment" title={`${row.ownerTitle} · ${row.ownerSource}`}>{row.ownerName}</span>
          : <span className="text-muted">—</span>}
      </Cell>
      <Cell className="text-muted">{row.category}</Cell>
      <Cell className="text-muted">{row.address}</Cell>
      <Cell className="font-mono text-xs">{row.phone}</Cell>
      <Cell><LineChip row={row} /></Cell>
      <Cell className="font-mono">{row.rating != null ? <span className="text-amber">{row.rating.toFixed(1)}★</span> : <span className="text-muted">—</span>}</Cell>
      <Cell className="font-mono text-xs">{row.email || <span className="text-muted">—</span>}</Cell>
      <Cell><Socials row={row} /></Cell>
    </>
  )
}

/** Line-type chip: text label always, colour as reinforcement (DESIGN §1/§4). */
const LINE_STYLE: Record<string, { label: string; cls: string }> = {
  mobile: { label: 'Mobile', cls: 'border-teal/50 bg-teal/10 text-teal' },
  landline: { label: 'Landline', cls: 'border-line bg-ink-700 text-muted' },
  voip: { label: 'VoIP', cls: 'border-amber/50 bg-amber/10 text-amber' },
}

function LineChip({ row }: { row: Business }) {
  const style = LINE_STYLE[row.lineType]
  if (!style) return <span className="text-muted">—</span>
  const caveat = "based on the number's original carrier assignment — ported numbers may differ"
  return (
    <span
      className={`rounded border px-1.5 py-0.5 font-mono text-[10px] ${style.cls}`}
      title={row.lineCarrier ? `${row.lineCarrier} — ${caveat}` : caveat}
    >
      {style.label}
    </span>
  )
}

function Socials({ row }: { row: Business }) {
  const links = SOCIAL_FIELDS.filter(([key]) => row[key])
  if (!links.length) return <span className="text-muted">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {links.map(([key, label]) => (
        <a key={key} href={row[key]} target="_blank" rel="noreferrer" title={`${label}: ${row[key]}`}
          className="rounded border border-line bg-ink-700 px-1.5 py-0.5 font-mono text-[10px] text-teal hover:border-teal">
          {label}
        </a>
      ))}
    </div>
  )
}

function Cell({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`truncate px-3 ${className}`}>{children}</div>
}

function Skeleton() {
  return (
    <>
      <div />
      {COLS.map((c) => (
        <div key={c.key} className="px-3"><div className="h-3 w-3/4 animate-pulse rounded bg-ink-600" /></div>
      ))}
    </>
  )
}

function EmptyState({ filtered }: { filtered: boolean }) {
  return (
    <div className="flex h-full items-center justify-center p-10">
      <div className="contour flex max-w-sm flex-col items-center rounded-xl border border-line/60 px-6 py-10 text-center">
        <svg width="34" height="34" viewBox="0 0 24 24" className="mb-3" aria-hidden>
          <path d="M12 22s7-6.4 7-12a7 7 0 1 0-14 0c0 5.6 7 12 7 12Z" fill="#FF6B3D" opacity="0.85" />
          <circle cx="12" cy="10" r="2.6" fill="#0B1322" />
        </svg>
        <p className="font-display text-base text-parchment">{filtered ? 'No matching records' : 'No survey data yet'}</p>
        <p className="mt-1 text-sm text-muted">
          {filtered
            ? 'Try loosening or clearing the filters above.'
            : 'Add keywords and plot a location, then start the survey to stream business records here.'}
        </p>
      </div>
    </div>
  )
}
