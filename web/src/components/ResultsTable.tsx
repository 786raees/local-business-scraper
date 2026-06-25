import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useStore } from '../lib/store'
import { useResults } from '../hooks/useResults'
import type { Business, ResultQuery } from '../lib/types'
import { SOCIAL_FIELDS } from '../lib/types'

const ROW_H = 40
const GRID = 'minmax(150px,1.3fr) minmax(120px,1fr) minmax(95px,0.8fr) minmax(160px,1.4fr) 130px 60px minmax(150px,1.1fr) minmax(140px,1fr)'

type Col = { key: keyof Business; label: string; sortable: boolean }
const COLS: Col[] = [
  { key: 'name', label: 'Name', sortable: true },
  { key: 'ownerName', label: 'Owner', sortable: true },
  { key: 'category', label: 'Category', sortable: true },
  { key: 'address', label: 'Address', sortable: true },
  { key: 'phone', label: 'Phone', sortable: true },
  { key: 'rating', label: 'Rating', sortable: true },
  { key: 'email', label: 'Email', sortable: true },
  { key: 'facebook', label: 'Socials', sortable: false },
]

const RATINGS = [
  { label: 'Any rating', value: 0 }, { label: '3.0+', value: 3 },
  { label: '3.5+', value: 3.5 }, { label: '4.0+', value: 4 }, { label: '4.5+', value: 4.5 },
]

export function ResultsTable() {
  const liveTotal = useStore((s) => s.total)

  const [text, setText] = useState({ q: '', category: '' })
  const [debText, setDebText] = useState(text)
  const [flags, setFlags] = useState({ minRating: 0, minReviews: 0, hasEmail: false, hasWebsite: false, hasPhone: false })
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
    sortBy: sort.by,
    sortDir: sort.dir,
  }), [debText, flags, sort])

  const { total, getRow } = useResults(query, liveTotal)

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

  const filtersActive = !!(debText.q || debText.category || flags.minRating || flags.minReviews
    || flags.hasEmail || flags.hasWebsite || flags.hasPhone)
  const clearFilters = () => {
    setText({ q: '', category: '' }); setDebText({ q: '', category: '' })
    setFlags({ minRating: 0, minReviews: 0, hasEmail: false, hasWebsite: false, hasPhone: false })
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
                    {row ? <Cells row={row} /> : <Skeleton />}
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
      <Cell className="font-mono">{row.rating != null ? <span className="text-amber">{row.rating.toFixed(1)}★</span> : <span className="text-muted">—</span>}</Cell>
      <Cell className="font-mono text-xs">{row.email || <span className="text-muted">—</span>}</Cell>
      <Cell><Socials row={row} /></Cell>
    </>
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
