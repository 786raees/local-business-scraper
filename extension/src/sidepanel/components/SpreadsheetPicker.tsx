import { useEffect, useMemo, useRef, useState } from 'react'
import { send } from '../api'
import { timeAgo } from '../../shared/format'
import { keyStore } from '../../shared/storage'
import type { SpreadsheetRef } from '../../shared/types'

interface Props {
  recentId?: string
  onPick: (sheet: SpreadsheetRef) => void
}

type LoadState =
  | { state: 'loading' }
  | { state: 'ready'; sheets: SpreadsheetRef[] }
  | { state: 'error'; message: string; status?: number }

/** S1 — pick spreadsheet (UX S1, DESIGN §6.5/§6.6). */
export function SpreadsheetPicker({ recentId, onPick }: Props) {
  const [load, setLoad] = useState<LoadState>({ state: 'loading' })
  const [query, setQuery] = useState('')
  const [email, setEmail] = useState('')
  const [copied, setCopied] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  async function refresh() {
    setLoad({ state: 'loading' })
    const res = await send<SpreadsheetRef[]>({ kind: 'sheets/listSpreadsheets' })
    setLoad(res.ok
      ? { state: 'ready', sheets: res.data }
      : { state: 'error', message: res.error, status: res.status })
  }

  useEffect(() => {
    void refresh()
    void keyStore.get().then((k) => setEmail(k?.client_email ?? ''))
    searchRef.current?.focus()
  }, [])

  // `/` refocuses search from anywhere on the screen (UX §3).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== searchRef.current) {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const filtered = useMemo(() => {
    if (load.state !== 'ready') return []
    const q = query.trim().toLowerCase()
    return q ? load.sheets.filter((s) => s.name.toLowerCase().includes(q)) : load.sheets
  }, [load, query])

  const recent = filtered.find((s) => s.id === recentId)
  const rest = recent ? filtered.filter((s) => s.id !== recent.id) : filtered

  function moveFocus(delta: number) {
    const rows = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('.row') ?? [])]
    const i = rows.indexOf(document.activeElement as HTMLButtonElement)
    rows[Math.max(0, Math.min(rows.length - 1, i + delta))]?.focus()
  }

  if (load.state === 'error') {
    const notShared = load.status === 403
    return (
      <div className="banner-error" role="alert">
        <div className="msg">
          {notShared
            ? `No spreadsheets are shared with ${email || 'the service account'} yet.`
            : load.message}
        </div>
        {email && (
          <button className="chip" onClick={() => void copyEmail()}>
            {copied ? 'Copied ✓' : `${email} ⧉`}
          </button>
        )}
        <button className="btn secondary" onClick={() => void refresh()}>Refresh</button>
      </div>
    )
  }

  async function copyEmail() {
    await navigator.clipboard.writeText(email)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <>
      <input
        ref={searchRef}
        className="search"
        placeholder="Search spreadsheets…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(1) } }}
      />
      <div
        ref={listRef}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(1) }
          if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(-1) }
        }}
      >
        {load.state === 'loading' && <div className="loading">Loading spreadsheets…</div>}
        {load.state === 'ready' && load.sheets.length === 0 && (
          <div className="banner-error">
            <div className="msg">
              No spreadsheets are shared with {email || 'the service account'} yet.
            </div>
            {email && (
              <button className="chip" onClick={() => void copyEmail()}>
                {copied ? 'Copied ✓' : `${email} ⧉`}
              </button>
            )}
            <button className="btn secondary" onClick={() => void refresh()}>Refresh</button>
          </div>
        )}
        {recent && (
          <>
            <div className="section-caption">Recent</div>
            <SheetRow sheet={recent} onPick={onPick} />
          </>
        )}
        {recent && rest.length > 0 && <div className="section-caption">All</div>}
        {rest.map((s) => <SheetRow key={s.id} sheet={s} onPick={onPick} />)}
      </div>
    </>
  )
}

function SheetRow({ sheet, onPick }: { sheet: SpreadsheetRef; onPick: Props['onPick'] }) {
  return (
    <button className="row" onClick={() => onPick(sheet)}>
      <div className="row-main">
        <div className="row-name">{sheet.name}</div>
        {sheet.modifiedTime && <div className="row-sub">modified {timeAgo(sheet.modifiedTime)}</div>}
      </div>
      <span className="chevron">›</span>
    </button>
  )
}
