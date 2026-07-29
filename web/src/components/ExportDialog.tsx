import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useStore } from '../lib/store'
import type { SpreadsheetRef, TabRef, ExportTarget, SplitExportResult } from '../lib/types'

type Step = 'destination' | 'spreadsheet' | 'tab' | 'split' | 'done'

interface Props { open: boolean; onClose: () => void }

interface SplitRow { tab: string; newName: string; percent: number }

const NEW_TAB = '__new__'

export function ExportDialog({ open, onClose }: Props) {
  const selectedIds = useStore((s) => s.selected)
  const clearSelection = useStore((s) => s.clearSelection)
  const total = useStore((s) => s.total)
  const resultQuery = useStore((s) => s.resultQuery)

  const [step, setStep] = useState<Step>('destination')
  const [scope, setScope] = useState<'all' | 'selected'>('all')
  const [sheets, setSheets] = useState<SpreadsheetRef[]>([])
  const [tabs, setTabs] = useState<TabRef[]>([])
  const [chosen, setChosen] = useState<SpreadsheetRef | null>(null)
  const [newTab, setNewTab] = useState('')
  const [splitRows, setSplitRows] = useState<SplitRow[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string; shareWith?: string } | null>(null)
  const [result, setResult] = useState<SplitExportResult | null>(null)

  // Reset every time the dialog is reopened, so a previous run's state never leaks.
  useEffect(() => {
    if (!open) return
    setStep('destination'); setChosen(null); setTabs([]); setNewTab('')
    setScope(selectedIds.size > 0 ? 'selected' : 'all')
    setSplitRows([]); setError(null); setResult(null); setBusy(false)
  }, [open, selectedIds.size])

  if (!open) return null

  const scopeCount = scope === 'selected' ? selectedIds.size : total
  const placeIds = scope === 'selected' ? [...selectedIds] : undefined

  const fail = (e: unknown) => {
    const err = e as { message?: string; shareWith?: string }
    setError({ message: err.message ?? 'Something went wrong', shareWith: err.shareWith })
  }

  const chooseSheets = async () => {
    setBusy(true); setError(null)
    try { setSheets(await api.getSpreadsheets()); setStep('spreadsheet') }
    catch (e) { fail(e) } finally { setBusy(false) }
  }

  const chooseSpreadsheet = async (s: SpreadsheetRef) => {
    setBusy(true); setError(null); setChosen(s)
    try { setTabs(await api.getTabs(s.id)); setStep('tab') }
    catch (e) { fail(e) } finally { setBusy(false) }
  }

  const runExport = async (targets: ExportTarget[]) => {
    if (!chosen) return
    setBusy(true); setError(null)
    try {
      setResult(await api.exportToSheet({ spreadsheetId: chosen.id, targets, placeIds }))
      if (scope === 'selected') clearSelection()
      setStep('done')
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

  // ---- split editor helpers ----
  const rowTitle = (r: SplitRow) => (r.tab === NEW_TAB ? r.newName.trim() : r.tab)
  const pctTotal = splitRows.reduce((a, r) => a + (r.percent || 0), 0)
  const titles = splitRows.map(rowTitle)
  const splitValid = splitRows.length >= 2
    && pctTotal === 100
    && titles.every((t) => t)
    && new Set(titles).size === titles.length
  const startSplit = () => {
    setSplitRows([
      { tab: tabs[0]?.title ?? NEW_TAB, newName: '', percent: 50 },
      { tab: tabs[1]?.title ?? NEW_TAB, newName: '', percent: 50 },
    ])
    setStep('split')
  }
  const patchRow = (i: number, p: Partial<SplitRow>) =>
    setSplitRows((rows) => rows.map((r, ri) => (ri === i ? { ...r, ...p } : r)))
  const runSplitExport = () => runExport(splitRows.map((r) => ({
    sheetTitle: rowTitle(r),
    createNew: r.tab === NEW_TAB,
    percent: r.percent,
  })))

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/70 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Export data"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-line bg-ink-900 p-5 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-display text-base font-700 text-parchment">Export data</h2>
          <button onClick={onClose} aria-label="Close" className="text-muted transition hover:text-parchment">✕</button>
        </div>

        {error && (
          <div className="mb-4 rounded-md border border-rose/40 bg-rose/10 p-3 text-sm text-rose">
            <p>{error.message}</p>
            {error.shareWith && (
              <p className="mt-2 text-xs text-muted">
                Share the spreadsheet with:{' '}
                <code className="break-all text-parchment">{error.shareWith}</code>
              </p>
            )}
          </div>
        )}

        {step === 'destination' && (
          <div className="space-y-2">
            {selectedIds.size > 0 && (
              <div className="mb-3 flex gap-2">
                <ScopeChip on={scope === 'selected'} onClick={() => setScope('selected')}>
                  Selected rows ({selectedIds.size.toLocaleString()})
                </ScopeChip>
                <ScopeChip on={scope === 'all'} onClick={() => setScope('all')}>
                  All rows ({total.toLocaleString()})
                </ScopeChip>
              </div>
            )}
            <a
              href={api.exportCsvUrl(resultQuery)}
              download
              onClick={onClose}
              className="block rounded-md border border-line px-3 py-2.5 text-sm text-parchment transition hover:border-teal hover:text-teal"
            >
              Download CSV
              <span className="block text-xs text-muted">
                Exports the current filtered view — streamed from disk
              </span>
            </a>
            <button
              onClick={chooseSheets}
              disabled={busy || scopeCount === 0}
              className="block w-full rounded-md border border-line px-3 py-2.5 text-left text-sm text-parchment transition hover:border-teal hover:text-teal disabled:opacity-40"
            >
              {busy ? 'Loading…' : 'Add to a Google Sheet'}
              <span className="block text-xs text-muted">
                {scope === 'selected'
                  ? `Appends the ${scopeCount.toLocaleString()} selected rows`
                  : 'Appends new rows, keeps existing formatting'}
              </span>
            </button>
          </div>
        )}

        {step === 'spreadsheet' && (
          <div className="space-y-1">
            <p className="eyebrow mb-2">Choose a spreadsheet</p>
            {sheets.length === 0 && (
              <p className="text-sm text-muted">No spreadsheets are shared with the service account yet.</p>
            )}
            {sheets.map((s) => (
              <button
                key={s.id}
                onClick={() => chooseSpreadsheet(s)}
                disabled={busy}
                className="block w-full rounded-md border border-line px-3 py-2 text-left text-sm text-parchment transition hover:border-teal hover:text-teal disabled:opacity-40"
              >
                {s.name}
              </button>
            ))}
          </div>
        )}

        {step === 'tab' && (
          <div className="space-y-1">
            <p className="eyebrow mb-2">
              {scopeCount.toLocaleString()} rows → “{chosen?.name}”
            </p>
            {tabs.map((t) => (
              <button
                key={t.sheetId}
                onClick={() => runExport([{ sheetTitle: t.title, percent: 100 }])}
                disabled={busy}
                className="flex w-full items-center justify-between rounded-md border border-line px-3 py-2 text-left text-sm text-parchment transition hover:border-teal hover:text-teal disabled:opacity-40"
              >
                <span>{t.title}</span>
                <span className="font-mono text-xs text-muted">{t.rowCount} rows</span>
              </button>
            ))}
            <div className="flex gap-2 pt-2">
              <input
                value={newTab}
                onChange={(e) => setNewTab(e.target.value)}
                placeholder="New tab name…"
                className="flex-1 rounded-md border border-line bg-ink-600/40 px-3 py-2 text-sm text-parchment placeholder:text-muted"
              />
              <button
                onClick={() => runExport([{ sheetTitle: newTab.trim(), createNew: true, percent: 100 }])}
                disabled={busy || !newTab.trim()}
                className="rounded-md border border-line px-3 py-2 text-sm text-parchment transition hover:border-teal hover:text-teal disabled:opacity-40"
              >
                Create
              </button>
            </div>
            <button
              onClick={startSplit}
              disabled={busy}
              className="mt-2 block w-full rounded-md border border-dashed border-line px-3 py-2 text-left text-sm text-muted transition hover:border-teal hover:text-teal disabled:opacity-40"
            >
              Split across multiple tabs by percentage…
            </button>
            {busy && <p className="pt-2 text-sm text-muted">Exporting…</p>}
          </div>
        )}

        {step === 'split' && (
          <div className="space-y-2">
            <p className="eyebrow mb-1">Split {scopeCount.toLocaleString()} rows across tabs</p>
            {splitRows.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  value={r.tab}
                  onChange={(e) => patchRow(i, { tab: e.target.value })}
                  className="field flex-1 cursor-pointer"
                >
                  {tabs.map((t) => <option key={t.sheetId} value={t.title}>{t.title}</option>)}
                  <option value={NEW_TAB}>+ New tab…</option>
                </select>
                {r.tab === NEW_TAB && (
                  <input
                    value={r.newName}
                    onChange={(e) => patchRow(i, { newName: e.target.value })}
                    placeholder="Tab name"
                    className="field w-28"
                  />
                )}
                <input
                  type="number" min={0} max={100}
                  value={r.percent}
                  onChange={(e) => patchRow(i, { percent: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                  className="field w-16 font-mono"
                  aria-label="percent"
                />
                <span className="text-xs text-muted">%</span>
                <button
                  onClick={() => setSplitRows((rows) => rows.filter((_, ri) => ri !== i))}
                  disabled={splitRows.length <= 2}
                  aria-label="Remove tab"
                  className="text-muted transition hover:text-rose disabled:opacity-30"
                >✕</button>
              </div>
            ))}
            <button
              onClick={() => setSplitRows((rows) => [...rows, { tab: NEW_TAB, newName: '', percent: 0 }])}
              className="text-xs text-teal underline-offset-2 hover:underline"
            >
              + Add tab
            </button>
            <div className="flex items-center justify-between pt-2">
              <span className={`font-mono text-sm ${pctTotal === 100 ? 'text-teal' : 'text-rose'}`}>
                total: {pctTotal}%
              </span>
              <button
                onClick={runSplitExport}
                disabled={busy || !splitValid}
                className="rounded-md border border-line px-4 py-2 text-sm text-parchment transition hover:border-teal hover:text-teal disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy ? 'Exporting…' : 'Export'}
              </button>
            </div>
            {!splitValid && pctTotal === 100 && (
              <p className="text-xs text-rose">Every row needs a distinct tab name.</p>
            )}
          </div>
        )}

        {step === 'done' && result && (
          <div className="space-y-3">
            {result.perTab.map((t) => (
              <p key={t.sheetTitle} className="text-sm text-parchment">
                <span className="font-mono text-muted">{t.sheetTitle}:</span>{' '}
                <span className="text-teal">{t.appended.toLocaleString()}</span> added
                {t.skipped > 0 && <> · {t.skipped.toLocaleString()} already present</>}
              </p>
            ))}
            <button
              onClick={onClose}
              className="w-full rounded-md border border-line px-3 py-2 text-sm text-parchment transition hover:border-teal hover:text-teal"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function ScopeChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick}
      className={`rounded-md border px-2.5 py-1.5 text-xs transition ${on
        ? 'border-survey bg-survey/15 text-survey'
        : 'border-line text-muted hover:text-parchment'}`}>
      {children}
    </button>
  )
}
