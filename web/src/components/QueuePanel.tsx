import { useStore } from '../lib/store'

const LED: Record<string, string> = {
  queued: 'bg-muted',
  running: 'bg-amber animate-pulse',
  done: 'bg-teal',
  error: 'bg-rose',
  blocked: 'bg-violet',
}

const ORDER = ['running', 'done', 'error', 'blocked', 'queued'] as const

// Grid search turns one location into hundreds of tile tasks. Past this many, a chip
// per task stops being readable (and stops being cheap to render), so we summarise.
const CHIP_LIMIT = 40

export function QueuePanel() {
  const queue = useStore((s) => s.queue)
  if (!queue.length) return null

  if (queue.length > CHIP_LIMIT) {
    const byStatus = ORDER
      .map((status) => ({ status, n: queue.filter((q) => q.status === status).length }))
      .filter((s) => s.n)
    const rows = queue.reduce((sum, q) => sum + q.count, 0)
    const active = queue.find((q) => q.status === 'running')
    return (
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-ink-900/50 px-5 py-2.5">
        <span className="eyebrow mr-1">Queue</span>
        {byStatus.map(({ status, n }) => (
          <span key={status} className="inline-flex items-center gap-1.5 font-mono text-[11px]">
            <span className={`h-1.5 w-1.5 rounded-full ${LED[status] ?? 'bg-muted'}`} />
            <span className="text-muted">{status}</span>
            <span className="text-parchment">{n}</span>
          </span>
        ))}
        <span className="font-mono text-[11px] text-muted">
          {queue.length} tiles · <span className="text-parchment">{rows.toLocaleString()}</span> rows
        </span>
        {active?.label && (
          <span className="truncate font-mono text-[11px] text-amber" title={active.label}>
            {active.label}
          </span>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-ink-900/50 px-5 py-2.5">
      <span className="eyebrow mr-1">Queue</span>
      {queue.map((q) => (
        <span
          key={q.id}
          title={q.error ?? q.label ?? q.status}
          className="inline-flex items-center gap-1.5 rounded-md border border-line bg-ink-700 px-2 py-0.5 font-mono text-[11px]"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${LED[q.status] ?? 'bg-muted'}`} />
          <span className="text-muted">T{q.id}</span>
          <span className="text-parchment">{q.count}</span>
        </span>
      ))}
    </div>
  )
}
