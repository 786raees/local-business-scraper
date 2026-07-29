import { useEffect, useRef, useState } from 'react'
import { send } from '../api'
import type { TabInfo } from '../../shared/messages'

interface Props {
  spreadsheetId: string
  onPick: (tab: TabInfo) => void
}

type LoadState =
  | { state: 'loading' }
  | { state: 'ready'; tabs: TabInfo[] }
  | { state: 'error'; message: string }

/** S2 — pick tab (UX S2). Invalid tabs are disabled with the missing headers named. */
export function TabPicker({ spreadsheetId, onPick }: Props) {
  const [load, setLoad] = useState<LoadState>({ state: 'loading' })
  const listRef = useRef<HTMLDivElement>(null)

  async function refresh() {
    setLoad({ state: 'loading' })
    const res = await send<TabInfo[]>({ kind: 'sheets/listTabs', spreadsheetId })
    setLoad(res.ok ? { state: 'ready', tabs: res.data } : { state: 'error', message: res.error })
  }

  useEffect(() => { void refresh() }, [spreadsheetId])

  function moveFocus(delta: number) {
    const rows = [...(listRef.current?.querySelectorAll<HTMLButtonElement>('.row:enabled') ?? [])]
    const i = rows.indexOf(document.activeElement as HTMLButtonElement)
    rows[Math.max(0, Math.min(rows.length - 1, i + delta))]?.focus()
  }

  if (load.state === 'loading') return <div className="loading">Loading tabs…</div>
  if (load.state === 'error') {
    return (
      <div className="banner-error" role="alert">
        <div className="msg">{load.message}</div>
        <button className="btn secondary" onClick={() => void refresh()}>Retry</button>
      </div>
    )
  }

  return (
    <div
      ref={listRef}
      onKeyDown={(e) => {
        if (e.key === 'ArrowDown') { e.preventDefault(); moveFocus(1) }
        if (e.key === 'ArrowUp') { e.preventDefault(); moveFocus(-1) }
      }}
    >
      {load.tabs.map((tab) => (
        <button
          key={tab.sheetId}
          className="row"
          disabled={tab.missing.length > 0}
          onClick={() => onPick(tab)}
          title={tab.missing.length > 0 ? `Missing headers: ${tab.missing.join(', ')}` : undefined}
        >
          <div className="row-main">
            <div className="row-name">{tab.title}</div>
            {tab.missing.length > 0
              ? <div className="row-sub bad">missing: {tab.missing.join(', ')}</div>
              : <div className="row-sub tabular">{tab.rowCount.toLocaleString()} rows</div>}
          </div>
          <span className="chevron">›</span>
        </button>
      ))}
    </div>
  )
}
