import { useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useStore } from '../lib/store'
import { useResults } from '../hooks/useResults'
import type { Business } from '../lib/types'

const ROW_H = 40
const GRID = 'minmax(160px,1.4fr) minmax(110px,1fr) minmax(180px,1.6fr) 130px 70px 80px 80px minmax(160px,1.2fr)'

const HEADERS = ['Name', 'Category', 'Address', 'Phone', 'Website', 'Rating', 'Reviews', 'Email']

export function ResultsTable() {
  const liveTotal = useStore((s) => s.total)
  const [raw, setRaw] = useState('')
  const [filter, setFilter] = useState('')

  // Debounce the filter so each keystroke doesn't re-query the server.
  useEffect(() => {
    const id = setTimeout(() => setFilter(raw.trim()), 300)
    return () => clearTimeout(id)
  }, [raw])

  const { total, getRow } = useResults(filter, liveTotal)

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: total,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 12,
  })

  return (
    <div className="flex flex-1 flex-col overflow-hidden p-5">
      <div className="mb-3 flex items-center gap-3">
        <input
          value={raw}
          onChange={(e) => setRaw(e.target.value)}
          placeholder="Filter results…"
          className="field max-w-xs"
        />
        <span className="ml-auto font-mono text-xs text-muted">
          <span className="text-teal">{total.toLocaleString()}</span> rows
        </span>
      </div>

      <div className="flex flex-1 flex-col overflow-hidden rounded-lg border border-line">
        {/* header */}
        <div
          className="grid shrink-0 border-b border-line bg-ink-900/95 font-mono text-[10px] uppercase tracking-wider text-muted"
          style={{ gridTemplateColumns: GRID }}
        >
          {HEADERS.map((h) => <div key={h} className="px-3 py-2.5">{h}</div>)}
        </div>

        {/* virtual scroll body */}
        <div ref={scrollRef} className="relative flex-1 overflow-auto">
          {total === 0 ? (
            <EmptyState />
          ) : (
            <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
              {virtualizer.getVirtualItems().map((vi) => {
                const row = getRow(vi.index)
                return (
                  <div
                    key={vi.key}
                    className="absolute left-0 top-0 grid w-full items-center border-b border-line/50 text-sm hover:bg-ink-600/40"
                    style={{ height: ROW_H, transform: `translateY(${vi.start}px)`, gridTemplateColumns: GRID }}
                  >
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

function Cells({ row }: { row: Business }) {
  return (
    <>
      <Cell className="text-parchment">{row.name}</Cell>
      <Cell className="text-muted">{row.category}</Cell>
      <Cell className="text-muted">{row.address}</Cell>
      <Cell className="font-mono text-xs">{row.phone}</Cell>
      <Cell>
        {row.website
          ? <a href={row.website} target="_blank" rel="noreferrer" className="text-teal hover:underline">link</a>
          : <span className="text-muted">—</span>}
      </Cell>
      <Cell className="font-mono">{row.rating != null ? <span className="text-amber">{row.rating.toFixed(1)}★</span> : <span className="text-muted">—</span>}</Cell>
      <Cell className="font-mono text-xs text-muted">{row.reviewCount ?? ''}</Cell>
      <Cell className="font-mono text-xs">{row.email || <span className="text-muted">—</span>}</Cell>
    </>
  )
}

function Cell({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return <div className={`truncate px-3 ${className}`}>{children}</div>
}

function Skeleton() {
  return (
    <>
      {HEADERS.map((_, i) => (
        <div key={i} className="px-3"><div className="h-3 w-3/4 animate-pulse rounded bg-ink-600" /></div>
      ))}
    </>
  )
}

function EmptyState() {
  return (
    <div className="flex h-full items-center justify-center p-10">
      <div className="contour flex max-w-sm flex-col items-center rounded-xl border border-line/60 px-6 py-10 text-center">
        <svg width="34" height="34" viewBox="0 0 24 24" className="mb-3" aria-hidden>
          <path d="M12 22s7-6.4 7-12a7 7 0 1 0-14 0c0 5.6 7 12 7 12Z" fill="#FF6B3D" opacity="0.85" />
          <circle cx="12" cy="10" r="2.6" fill="#0B1322" />
        </svg>
        <p className="font-display text-base text-parchment">No survey data yet</p>
        <p className="mt-1 text-sm text-muted">
          Add keywords and plot a location, then start the survey to stream business records here.
        </p>
      </div>
    </div>
  )
}
