import { useStore } from '../lib/store'

const LED: Record<string, string> = {
  queued: 'bg-muted',
  running: 'bg-amber animate-pulse',
  done: 'bg-teal',
  error: 'bg-rose',
  blocked: 'bg-violet',
}

export function QueuePanel() {
  const queue = useStore((s) => s.queue)
  if (!queue.length) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-line bg-ink-900/50 px-5 py-2.5">
      <span className="eyebrow mr-1">Queue</span>
      {queue.map((q) => (
        <span
          key={q.id}
          title={q.error ?? q.status}
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
