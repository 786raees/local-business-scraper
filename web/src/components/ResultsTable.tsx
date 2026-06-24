import { useMemo, useState } from 'react'
import {
  useReactTable, getCoreRowModel, getFilteredRowModel, flexRender,
} from '@tanstack/react-table'
import type { ColumnDef } from '@tanstack/react-table'
import { useStore } from '../lib/store'
import type { Business } from '../lib/types'

const COLS: ColumnDef<Business>[] = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'category', header: 'Category' },
  { accessorKey: 'address', header: 'Address' },
  {
    accessorKey: 'phone', header: 'Phone',
    cell: (c) => <span className="font-mono text-xs">{String(c.getValue() ?? '')}</span>,
  },
  {
    accessorKey: 'website', header: 'Website',
    cell: (c) => {
      const v = String(c.getValue() ?? '')
      return v ? <a href={v} target="_blank" rel="noreferrer" className="text-teal hover:underline">link</a> : ''
    },
  },
  {
    accessorKey: 'rating', header: 'Rating',
    cell: (c) => {
      const v = c.getValue() as number | null
      return v == null ? <span className="text-muted">—</span>
        : <span className="font-mono text-amber">{v.toFixed(1)}★</span>
    },
  },
  {
    accessorKey: 'reviewCount', header: 'Reviews',
    cell: (c) => <span className="font-mono text-xs text-muted">{String(c.getValue() ?? '')}</span>,
  },
  { accessorKey: 'email', header: 'Email', cell: (c) => <span className="font-mono text-xs">{String(c.getValue() ?? '')}</span> },
]

export function ResultsTable() {
  const results = useStore((s) => s.results)
  const [filter, setFilter] = useState('')
  const data = useMemo(() => results, [results])
  const table = useReactTable({
    data, columns: COLS,
    state: { globalFilter: filter },
    onGlobalFilterChange: setFilter,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  return (
    <div className="flex flex-1 flex-col overflow-hidden p-5">
      <div className="mb-3 flex items-center gap-3">
        <input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter results…"
          className="field max-w-xs"
        />
        <span className="ml-auto font-mono text-xs text-muted">
          {table.getFilteredRowModel().rows.length} / {results.length}
        </span>
      </div>

      <div className="flex-1 overflow-auto rounded-lg border border-line">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="sticky top-0 z-10 bg-ink-900/95 backdrop-blur">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th key={h.id} className="border-b border-line px-3 py-2.5 font-mono text-[10px] uppercase tracking-wider text-muted">
                    {flexRender(h.column.columnDef.header, h.getContext())}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr key={row.id} className="border-b border-line/60 transition hover:bg-ink-600/40">
                {row.getVisibleCells().map((cell) => (
                  <td key={cell.id} className="max-w-[260px] truncate px-3 py-2 text-parchment">
                    {flexRender(
                      cell.column.columnDef.cell ?? ((c) => String(c.getValue() ?? '')),
                      cell.getContext(),
                    )}
                  </td>
                ))}
              </tr>
            ))}
            {!results.length && (
              <tr>
                <td colSpan={COLS.length} className="px-3 py-20">
                  <EmptyState />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="contour mx-auto flex max-w-sm flex-col items-center rounded-xl border border-line/60 px-6 py-10 text-center">
      <svg width="34" height="34" viewBox="0 0 24 24" className="mb-3" aria-hidden>
        <path d="M12 22s7-6.4 7-12a7 7 0 1 0-14 0c0 5.6 7 12 7 12Z" fill="#FF6B3D" opacity="0.85" />
        <circle cx="12" cy="10" r="2.6" fill="#0B1322" />
      </svg>
      <p className="font-display text-base text-parchment">No survey data yet</p>
      <p className="mt-1 text-sm text-muted">
        Add keywords and plot a location, then start the survey to stream business records here.
      </p>
    </div>
  )
}
