import { useStore } from '../lib/store'
import { api } from '../lib/api'

export function TopBar() {
  const { keywords, locations, settings, total, progress, queue, running, setRunning, reset } = useStore()
  const start = async () => {
    reset(); setRunning(true)
    await api.startJob({ keywords, locations, settings })
  }
  const stop = async () => { await api.stopJob(); setRunning(false) }
  const clear = async () => {
    if (!window.confirm('Clear all scraped data? This permanently deletes every stored record.')) return
    await api.clearResults()
    reset()
  }

  // Record-level progress: completed tasks count fully, plus the fraction of the
  // in-progress task's records against maxResults. Reaches 100% when all tasks finish.
  const finishedRecords = queue
    .filter((q) => q.status === 'done' || q.status === 'error')
    .reduce((sum, q) => sum + q.count, 0)
  const currentRecords = Math.max(0, total - finishedRecords)
  const currentFraction = settings.maxResults > 0 ? Math.min(1, currentRecords / settings.maxResults) : 0
  const tasksProgress = progress.done + (progress.done < progress.total ? currentFraction : 0)
  const pct = progress.total ? Math.min(100, Math.round((tasksProgress / progress.total) * 100)) : 0
  const canStart = !running && keywords.length > 0 && locations.length > 0

  return (
    <header className="contour relative border-b border-line bg-ink-900/80">
      <div className="flex items-center gap-5 px-5 py-3">
        <div className="flex items-center gap-3">
          <PinMark />
          <div className="leading-tight">
            <h1 className="font-display text-lg font-700 tracking-tight text-parchment">Atlas</h1>
            <p className="eyebrow -mt-0.5">Maps Data Console</p>
          </div>
        </div>

        <div className="mx-1 h-8 w-px bg-line" />

        <button
          onClick={start}
          disabled={!canStart}
          className="group inline-flex items-center gap-2 rounded-md bg-survey px-3.5 py-1.5 text-sm font-600 text-ink-900
                     shadow-[0_0_0_1px_rgba(255,107,61,0.4)] transition hover:brightness-110
                     disabled:cursor-not-allowed disabled:bg-ink-600 disabled:text-muted disabled:shadow-none"
        >
          <span className={`h-1.5 w-1.5 rounded-full ${running ? 'bg-ink-900/60' : 'bg-ink-900'} ${running ? '' : 'group-hover:animate-ping'}`} />
          {running ? 'Surveying…' : 'Start survey'}
        </button>
        <button
          onClick={stop}
          disabled={!running}
          className="rounded-md border border-line px-3 py-1.5 text-sm font-500 text-parchment transition
                     hover:border-rose hover:text-rose disabled:cursor-not-allowed disabled:opacity-40"
        >
          Stop
        </button>

        <div className="flex flex-1 items-center gap-3">
          <div className="relative h-1.5 flex-1 overflow-hidden rounded-full bg-ink-600">
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-survey to-amber transition-all duration-500"
              style={{ width: `${pct}%` }}
            />
          </div>
          <span className="whitespace-nowrap font-mono text-xs text-muted">
            <span className="text-teal">{total.toLocaleString()}</span> rows
            <span className="px-1.5 text-line">·</span>
            {progress.done}/{progress.total} tasks
          </span>
        </div>

        <a
          href={total ? api.exportCsvUrl() : undefined}
          download
          aria-disabled={!total}
          onClick={(e) => { if (!total) e.preventDefault() }}
          className={`rounded-md border border-line px-3 py-1.5 text-sm font-500 text-parchment transition
                     hover:border-teal hover:text-teal ${!total ? 'cursor-not-allowed opacity-40' : ''}`}
        >
          Export CSV
        </a>
        <button
          onClick={clear}
          disabled={!total || running}
          title={running ? 'Stop the survey before clearing' : 'Delete all stored records'}
          className="rounded-md border border-line px-3 py-1.5 text-sm font-500 text-parchment transition
                     hover:border-rose hover:text-rose disabled:cursor-not-allowed disabled:opacity-40"
        >
          Clear data
        </button>
      </div>
    </header>
  )
}

function PinMark() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M12 22s7-6.4 7-12a7 7 0 1 0-14 0c0 5.6 7 12 7 12Z" fill="#FF6B3D" />
      <circle cx="12" cy="10" r="2.6" fill="#0B1322" />
    </svg>
  )
}
