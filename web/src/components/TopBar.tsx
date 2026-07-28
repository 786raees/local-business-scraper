import { useState } from 'react'
import { useStore } from '../lib/store'
import { api } from '../lib/api'
import { ExportDialog } from './ExportDialog'

export function TopBar() {
  const { keywords, locations, settings, total, duplicates, progress, running, setRunning, reset } = useStore()
  const selectedCount = useStore((s) => s.selected.size)
  const [exportOpen, setExportOpen] = useState(false)
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

  // maxResults is a whole-job budget, so rows-against-budget is the truest measure of
  // how far along the run is. A job can also end early by exhausting its tiles, so take
  // whichever of the two is further along rather than stalling the bar at neither.
  const rowsPct = settings.maxResults > 0 ? (total / settings.maxResults) * 100 : 0
  const tasksPct = progress.total ? (progress.done / progress.total) * 100 : 0
  const pct = Math.min(100, Math.round(Math.max(rowsPct, tasksPct)))
  const canStart = !running && keywords.length > 0 && locations.length > 0

  return (
    <>
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
            {duplicates > 0 && (
              <>
                <span className="px-1.5 text-line">·</span>
                <span title="Repeat sightings merged across overlapping grid tiles">
                  {duplicates.toLocaleString()} dupes merged
                </span>
              </>
            )}
            <span className="px-1.5 text-line">·</span>
            {progress.done}/{progress.total} {settings.segment ? 'tiles' : 'tasks'}
          </span>
        </div>

        <button
          onClick={() => setExportOpen(true)}
          disabled={!total}
          title={!total ? 'Nothing to export yet' : 'Export as CSV or into a Google Sheet'}
          className="rounded-md border border-line px-3 py-1.5 text-sm font-500 text-parchment transition
                     hover:border-teal hover:text-teal disabled:cursor-not-allowed disabled:opacity-40"
        >
          Export{selectedCount > 0 && <span className="text-teal"> ({selectedCount.toLocaleString()} selected)</span>}
        </button>
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
    <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
    </>
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
