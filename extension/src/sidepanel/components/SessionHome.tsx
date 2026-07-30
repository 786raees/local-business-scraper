import { useEffect, useRef, useState } from 'react'
import { send } from '../api'
import { ActiveCall } from './ActiveCall'
import { DevHarness } from './DevHarness'
import { DialFilterPanel } from './DialFilterPanel'
import { ErrorBanner } from './ErrorBanner'
import { StartFromPicker } from './StartFromPicker'
import { UnsyncedChip } from './UnsyncedChip'
import { timeAgo } from '../../shared/format'
import { resumeStore } from '../../shared/storage'
import type { BgToPanel } from '../../shared/messages'
import type { SessionSnapshot } from '../../shared/types'

interface Props {
  spreadsheetId: string
  tabTitle: string
  onChangeList: () => void
}

/**
 * S3 — session home (UX S3): resume card, one big Start button, start-from
 * with live name preview, dial filter. Hydrates first; a worker that already
 * holds this tab answers without a network re-read (story 04).
 */
export function SessionHome({ spreadsheetId, tabTitle, onChangeList }: Props) {
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [resumeWhen, setResumeWhen] = useState<string>('')

  // Start-from picker (story 12 — replaced the row-number input)
  const [fromOpen, setFromOpen] = useState(false)
  const startRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const onMsg = (msg: BgToPanel) => {
      if (msg.kind === 'state') setSnapshot(msg.snapshot)
    }
    chrome.runtime.onMessage.addListener(onMsg)
    return () => chrome.runtime.onMessage.removeListener(onMsg)
  }, [])

  useEffect(() => {
    void (async () => {
      setError(null)
      const hydrated = await send<SessionSnapshot>({ kind: 'panel/hydrate' })
      if (hydrated.ok
        && hydrated.data.tab?.title === tabTitle
        && hydrated.data.spreadsheet?.id === spreadsheetId
        && hydrated.data.leads.total > 0) {
        setSnapshot(hydrated.data)
      } else {
        setSnapshot(null)
        const loaded = await send<SessionSnapshot>({
          kind: 'sheets/loadLeads', spreadsheetId, sheetTitle: tabTitle,
        })
        if (loaded.ok) setSnapshot(loaded.data)
        else { setError(loaded.error); return }
      }
      const point = await resumeStore.get(spreadsheetId, tabTitle)
      if (point) setResumeWhen(timeAgo(point.updatedAt))
    })()
  }, [spreadsheetId, tabTitle])

  // Space starts from anywhere on the screen (UX §3).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName
      if (e.key === ' ' && tag !== 'INPUT' && tag !== 'SELECT' && tag !== 'TEXTAREA') {
        e.preventDefault()
        startRef.current?.click()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  async function start(fromRowNum?: number) {
    const res = await send<SessionSnapshot>({ kind: 'session/start', fromRow: fromRowNum })
    if (res.ok) { setSnapshot(res.data); setFromOpen(false) }
    else setError(res.error)
  }

  if (error) {
    return (
      <div className="banner-error" role="alert">
        <div className="msg">{error}</div>
        <button className="btn secondary" onClick={() => { setError(null); onChangeList() }}>
          Change list
        </button>
        <button className="btn secondary" onClick={() => setError(null)}>Dismiss</button>
      </div>
    )
  }

  if (!snapshot || snapshot.phase === 'loading-leads') {
    return (
      <div className="loading tabular" aria-live="polite">
        Reading {snapshot?.leads.total
          ? `${snapshot.leads.total.toLocaleString()} leads…`
          : 'leads…'}
      </div>
    )
  }

  const active = ['dialing', 'in-call', 'between-calls', 'awaiting-outcome']
    .includes(snapshot.phase)
  if (active) {
    return <ActiveCall snapshot={snapshot} />
  }

  if (snapshot.phase === 'error' && snapshot.error) {
    return (
      <ErrorBanner
        error={snapshot.error}
        onDismiss={() => void send<SessionSnapshot>({ kind: 'session/stop', hard: true })
          .then((r) => { if (r.ok) setSnapshot(r.data) })}
      />
    )
  }

  if (snapshot.atEnd) {
    const tally = snapshot.tally ?? {}
    const dialed = Object.values(tally).reduce((a, b) => a + (b ?? 0), 0)
    return (
      <div className="session-home">
        <div className="resume-card">
          <div className="card-title">That&apos;s the list 🎉</div>
          <p className="tabular" style={{ margin: 0, font: 'var(--type-body)' }}>
            {dialed} dialed · {tally['Answered'] ?? 0} answered · {tally['Interested'] ?? 0} interested
          </p>
        </div>
        <div className="start-from-actions">
          <button
            className="btn primary"
            onClick={() => void send<SessionSnapshot>({ kind: 'session/setCursor', rowIndex: null })
              .then((r) => { if (r.ok) setSnapshot(r.data) })}
          >
            Back to leads
          </button>
          <button className="btn secondary" onClick={onChangeList}>Change tab</button>
        </div>
      </div>
    )
  }

  const { leads, cursor, currentLead, criteria } = snapshot
  const returning = cursor > 0 && currentLead && !snapshot.atEnd
  const startLabel = returning
    ? `▶ Resume from row ${currentLead.rowIndex}`
    : '▶ Start dialing'

  return (
    <div className="session-home">
      <div className="resume-card">
        {returning ? (
          <>
            <div className="card-title">
              You stopped at row {currentLead.rowIndex} — <strong>{currentLead.name}</strong>
            </div>
            {resumeWhen && <div className="row-sub">{resumeWhen}</div>}
          </>
        ) : (
          <div className="card-title tabular">
            Ready — {leads.total.toLocaleString()} leads, {leads.dialable.toLocaleString()} dialable
            {leads.skippedNoPhone > 0 && (
              <span
                className="row-sub"
                title={`${leads.skippedNoPhone} rows have no phone`}
              >
                {' '}({leads.skippedNoPhone} without phone)
              </span>
            )}
          </div>
        )}
      </div>

      <button ref={startRef} className="btn primary big-btn" onClick={() => void start()}>
        {startLabel}
      </button>

      {!fromOpen ? (
        <button className="icon-btn" onClick={() => setFromOpen(true)}>Start from…</button>
      ) : (
        <StartFromPicker
          cursor={cursor}
          resumeName={currentLead?.name}
          onPicked={setSnapshot}
          onClose={() => { setFromOpen(false); startRef.current?.focus() }}
        />
      )}

      <DialFilterPanel
        criteria={criteria}
        dialable={leads.dialable}
        excludedBlank={leads.excludedBlank}
        onChanged={setSnapshot}
      />

      <DevHarness />

      <div className="session-bar">
        <UnsyncedChip count={snapshot.unsyncedOutcomes} paused={snapshot.queuePaused} />
        <div className="progress-line tabular">
          {snapshot.phase === 'paused' ? 'Paused · ' : ''}
          {Math.min(cursor + 1, leads.dialable)} of {leads.dialable.toLocaleString()}
          {currentLead ? ` · row ${currentLead.rowIndex}` : ''}
        </div>
        <div className="progress-track">
          <div
            className="progress-fill"
            style={{ width: leads.dialable ? `${(cursor / leads.dialable) * 100}%` : 0 }}
          />
        </div>
      </div>
    </div>
  )
}
