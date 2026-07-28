import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import type { SpreadsheetRef, TabRef, ExportResult } from '../lib/types'

type Step = 'destination' | 'spreadsheet' | 'tab' | 'done'

interface Props { open: boolean; onClose: () => void }

export function ExportDialog({ open, onClose }: Props) {
  const [step, setStep] = useState<Step>('destination')
  const [sheets, setSheets] = useState<SpreadsheetRef[]>([])
  const [tabs, setTabs] = useState<TabRef[]>([])
  const [chosen, setChosen] = useState<SpreadsheetRef | null>(null)
  const [newTab, setNewTab] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string; shareWith?: string } | null>(null)
  const [result, setResult] = useState<ExportResult | null>(null)

  // Reset every time the dialog is reopened, so a previous run's state never leaks.
  useEffect(() => {
    if (!open) return
    setStep('destination'); setChosen(null); setTabs([]); setNewTab('')
    setError(null); setResult(null); setBusy(false)
  }, [open])

  if (!open) return null

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

  const runExport = async (sheetTitle: string, createNew: boolean) => {
    if (!chosen || !sheetTitle.trim()) return
    setBusy(true); setError(null)
    try {
      setResult(await api.exportToSheet({
        spreadsheetId: chosen.id, sheetTitle: sheetTitle.trim(), createNew,
      }))
      setStep('done')
    } catch (e) { fail(e) } finally { setBusy(false) }
  }

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
            <a
              href={api.exportCsvUrl()}
              download
              onClick={onClose}
              className="block rounded-md border border-line px-3 py-2.5 text-sm text-parchment transition hover:border-teal hover:text-teal"
            >
              Download CSV
              <span className="block text-xs text-muted">Streamed from disk — works at any size</span>
            </a>
            <button
              onClick={chooseSheets}
              disabled={busy}
              className="block w-full rounded-md border border-line px-3 py-2.5 text-left text-sm text-parchment transition hover:border-teal hover:text-teal disabled:opacity-40"
            >
              {busy ? 'Loading…' : 'Add to a Google Sheet'}
              <span className="block text-xs text-muted">Appends new rows, keeps existing formatting</span>
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
            <p className="eyebrow mb-2">Choose a tab in “{chosen?.name}”</p>
            {tabs.map((t) => (
              <button
                key={t.sheetId}
                onClick={() => runExport(t.title, false)}
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
                onClick={() => runExport(newTab, true)}
                disabled={busy || !newTab.trim()}
                className="rounded-md border border-line px-3 py-2 text-sm text-parchment transition hover:border-teal hover:text-teal disabled:opacity-40"
              >
                Create
              </button>
            </div>
            {busy && <p className="pt-2 text-sm text-muted">Exporting…</p>}
          </div>
        )}

        {step === 'done' && result && (
          <div className="space-y-3">
            <p className="text-sm text-parchment">
              <span className="text-teal">{result.appended.toLocaleString()}</span> rows added
              {result.skipped > 0 && <> · {result.skipped.toLocaleString()} already present</>}
            </p>
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
