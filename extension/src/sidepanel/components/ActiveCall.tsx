import { useEffect, useRef, useState } from 'react'
import { send } from '../api'
import { CALL_STATUS_VALUES, OUTCOME_BUCKET } from '../../sheets/vocab'
import { truncateMiddle } from '../../shared/format'
import { lineTypeStyle, lineTypeTooltip } from '../../shared/lineType'
import { settingsStore } from '../../shared/storage'
import { UnsyncedChip } from './UnsyncedChip'
import type { CallOutcome, Lead, SessionSnapshot } from '../../shared/types'

/**
 * S4 — live call (DESIGN §6.4, UX S4): the full read-only lead card. Nothing
 * to misclick during a conversation; outcome capture (S5) stays minimal until
 * story 09 replaces it with the keyboard-driven grid.
 */
export function ActiveCall({ snapshot }: { snapshot: SessionSnapshot }) {
  const { phase, callState, currentLead, callStartedAt, preselectedOutcome, leads, cursor } = snapshot
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    if (!callStartedAt) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [callStartedAt])

  // Timer derives from the connect timestamp, so panel close/reopen keeps it
  // correct (UX §4.2) — never a locally-accumulated interval count.
  const elapsed = callStartedAt ? Math.max(0, Math.floor((now - callStartedAt) / 1000)) : null
  const timer = elapsed !== null
    ? `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`
    : null

  const stateLabel =
    phase === 'between-calls' ? `Next: ${currentLead?.name ?? '—'}`
    : phase === 'awaiting-outcome' ? 'Call ended — log the outcome'
    : callState === 'ringing' ? 'Ringing…'
    : callState === 'in-call' ? 'On call'
    : 'Calling…'

  const dotClass =
    phase === 'awaiting-outcome' || phase === 'between-calls' ? 'dot idle'
    : callState === 'in-call' ? 'dot incall'
    : callState === 'ringing' ? 'dot ringing'
    : 'dot dialing'

  return (
    <div className="session-home">
      <div className="lead-card">
        <div className="state-line" aria-live="polite">
          <span className={dotClass} />
          <span>{stateLabel}</span>
          {timer && phase === 'in-call' && <span className="tabular timer">{timer}</span>}
          {snapshot.recording === 'on' && <span className="rec-chip">● REC</span>}
        </div>

        {snapshot.recording === 'failed' && (
          <div className="row-sub bad" role="status">
            Mic blocked — call not recorded.
          </div>
        )}

        {phase !== 'between-calls' && currentLead && <LeadCard lead={currentLead} />}
      </div>

      {phase === 'awaiting-outcome' && (
        <>
          <OutcomePanel preselected={preselectedOutcome} />
          {snapshot.lastRecording && (
            <RecordingStrip recording={snapshot.lastRecording} />
          )}
          {currentLead?.lineType === 'voip' && (
            <div className="voip-hint">
              VoIP number — Wrong Number/DNC may be worth considering if it never connects.
            </div>
          )}
        </>
      )}

      {phase === 'between-calls' && (
        <BetweenCalls nextName={currentLead?.name} lastOutcome={snapshot.lastOutcome} />
      )}

      <div className="session-bar">
        <UnsyncedChip count={snapshot.unsyncedOutcomes} paused={snapshot.queuePaused} />
        <div className="progress-line tabular">
          {Math.min(cursor + 1, leads.dialable)} of {leads.dialable.toLocaleString()}
          {currentLead ? ` · row ${currentLead.rowIndex}` : ''}
        </div>
        <div className="progress-track">
          <div
            className="progress-fill"
            style={{ width: leads.dialable ? `${(cursor / leads.dialable) * 100}%` : 0 }}
          />
        </div>
        <div className="start-from-actions">
          <button
            className="btn secondary"
            title="Finish this call, then pause"
            onClick={() => void send({ kind: 'session/stop', hard: false })}
          >
            Stop
          </button>
          <button
            className="btn danger"
            title="Hang up and pause immediately"
            onClick={() => void send({ kind: 'session/stop', hard: true })}
          >
            Stop now
          </button>
          {(phase === 'dialing' || phase === 'awaiting-outcome') && (
            <button className="btn secondary" onClick={() => void send({ kind: 'session/skip' })}>
              Skip
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

const KEY_HINTS = ['1', '2', '3', '4', '5', '6', '7', '8']

/**
 * S5 — the one-keypress screen (DESIGN §6.3, UX S5): 1–8 confirm immediately,
 * N focuses the note, Enter confirms the pre-selected outcome. A timed-out
 * call pre-selects No Answer and confirms itself if untouched.
 */
function OutcomePanel({ preselected }: { preselected?: CallOutcome }) {
  const [note, setNote] = useState('')
  const noteRef = useRef<HTMLInputElement>(null)
  const [autoLeft, setAutoLeft] = useState<number | null>(null)

  function confirm(outcome: CallOutcome) {
    void send({ kind: 'call/outcome', outcome, note: note.trim() || undefined })
  }

  // Pre-selected No Answer auto-confirms after the inter-call delay (UX S5).
  useEffect(() => {
    if (!preselected) { setAutoLeft(null); return }
    let cancelled = false
    void settingsStore.get().then((s) => {
      if (cancelled) return
      setAutoLeft(s.interCallDelayMs)
      const started = Date.now()
      const tick = setInterval(() => {
        const left = s.interCallDelayMs - (Date.now() - started)
        if (left <= 0) {
          clearInterval(tick)
          if (!cancelled) confirm(preselected)
        } else {
          setAutoLeft(left)
        }
      }, 100)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselected])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const inNote = e.target === noteRef.current
      if (!inNote && KEY_HINTS.includes(e.key)) {
        e.preventDefault()
        confirm(CALL_STATUS_VALUES[Number(e.key) - 1] as CallOutcome)
      } else if (!inNote && (e.key === 'n' || e.key === 'N')) {
        e.preventDefault()
        noteRef.current?.focus()
      } else if (e.key === 'Enter' && preselected) {
        e.preventDefault()
        confirm(preselected)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preselected, note])

  return (
    <>
      <div className="outcome-grid">
        {CALL_STATUS_VALUES.map((value, i) => {
          const bucket = OUTCOME_BUCKET[value]
          const isPre = preselected === value
          return (
            <button
              key={value}
              className={`outcome-btn edge-${bucket}${isPre ? ' preselected' : ''}`}
              onClick={() => confirm(value)}
            >
              <span className="keycap">{KEY_HINTS[i]}</span>
              {value}
              {isPre && (
                <span className="auto-chip">
                  auto{autoLeft !== null ? ` ${Math.ceil(autoLeft / 1000)}s` : ''}
                </span>
              )}
            </button>
          )
        })}
      </div>
      <input
        ref={noteRef}
        className="search"
        style={{ margin: 0 }}
        placeholder="Add note — optional (N)"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
    </>
  )
}

/**
 * The between-calls countdown (UX S5.4–5.5): sweep bar, next lead, dial-now /
 * pause escapes, and the undo toast — the write hasn't hit the sheet yet.
 */
function BetweenCalls({ nextName, lastOutcome }: { nextName?: string; lastOutcome?: CallOutcome }) {
  const [delayMs, setDelayMs] = useState<number | null>(null)

  useEffect(() => {
    void settingsStore.get().then((s) => setDelayMs(s.interCallDelayMs))
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === ' ') { e.preventDefault(); void send({ kind: 'session/dialNow' }) }
      if (e.key === 'Escape') { e.preventDefault(); void send({ kind: 'session/stop', hard: false }) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="between-calls">
      {delayMs !== null && (
        <div className="countdown-track">
          <div className="countdown-fill" style={{ animationDuration: `${delayMs}ms` }} />
        </div>
      )}
      <div className="row-sub">Next: <strong>{nextName ?? '—'}</strong></div>
      {lastOutcome && (
        <div className="toast" role="status">
          Logged <strong>{lastOutcome}</strong>
          <button className="btn secondary" onClick={() => void send({ kind: 'session/undo' })}>
            Undo
          </button>
        </div>
      )}
      <div className="start-from-actions">
        <button className="btn primary" onClick={() => void send({ kind: 'session/dialNow' })}>
          Dial now (Space)
        </button>
        <button
          className="btn secondary"
          onClick={() => void send({ kind: 'session/stop', hard: false })}
        >
          Pause (Esc)
        </button>
      </div>
    </div>
  )
}

/**
 * Story 16 — the kept recording on S5: basename + duration + Discard. The
 * worker owns deletion; discarding here just sends the message, and the strip
 * disappears with the broadcast that follows.
 */
function RecordingStrip({ recording }: { recording: { file: string; durationMs: number } }) {
  const sec = Math.round(recording.durationMs / 1000)
  const dur = `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`
  return (
    <div className="recording-strip">
      <span className="row-sub tabular" title={recording.file}>
        🎙 {truncateMiddle(recording.file, 30)} · {dur}
      </span>
      <button
        className="btn secondary"
        title="Delete the file and keep it out of Notes"
        onClick={() => void send({ kind: 'recording/discard' })}
      >
        Discard
      </button>
    </div>
  )
}

const STAGE_CLASS: Record<string, string> = {
  'New': 'new', 'Contacted': 'contacted', 'Interested': 'interested',
  'Demo Booked': 'demo-booked', 'Trial Active': 'trial-active',
  'Closed-Won': 'closed-won', 'Closed-Lost': 'closed-lost',
  'Not Interested': 'not-interested', 'DNC': 'dnc',
}

/** The full read-only card (DESIGN §6.4). Missing values render '—'; the grid never reflows. */
function LeadCard({ lead }: { lead: Lead }) {
  const [notesOpen, setNotesOpen] = useState(false)
  const dash = <span className="muted">—</span>

  const rating = lead.rating
    ? `★ ${lead.rating}${lead.reviewCount ? ` (${lead.reviewCount})` : ''}`
    : null

  const owner = lead.ownerName
    ? `${lead.ownerName}${lead.ownerTitle ? ` · ${lead.ownerTitle}` : ''}`
    : null

  const prevBucket = lead.callStatus
    ? OUTCOME_BUCKET[lead.callStatus as CallOutcome] ?? 'neutral'
    : null

  return (
    <>
      <div className="lead-head">
        <div className="lead-name">{lead.name || '—'}</div>
        {lead.stage && (
          <span className={`stage-badge stage-${STAGE_CLASS[lead.stage] ?? 'new'}`}>
            {lead.stage}
          </span>
        )}
      </div>
      {owner && <div className="owner-line">{owner}</div>}

      <div className="fact-grid">
        <Fact label="Phone">
          {lead.phone ? <span className="tabular">{lead.phone}</span> : dash}
          <LineChip lead={lead} />
        </Fact>
        <Fact label="Category">{lead.category ?? dash}</Fact>
        <Fact label="Rating">{rating ? <span className="tabular">{rating}</span> : dash}</Fact>
        <Fact label="Address">
          {lead.address ? <span className="clamp-2">{lead.address}</span> : dash}
        </Fact>
        <Fact label="Website">
          {lead.website ? (
            <a href={lead.website} target="_blank" rel="noreferrer" title={lead.website}>
              {truncateMiddle(lead.website.replace(/^https?:\/\//, ''), 34)}
            </a>
          ) : dash}
        </Fact>
        <Fact label="Row"><span className="tabular">{lead.rowIndex}</span></Fact>
      </div>

      {(lead.callStatus || lead.notes) && (
        <div className="history-strip">
          {prevBucket && (
            <span className={`status-chip chip-${prevBucket}`}>{lead.callStatus}</span>
          )}
          {lead.notes && (
            <button
              className={`notes${notesOpen ? '' : ' clamp-3'}`}
              title={notesOpen ? 'Collapse notes' : 'Expand notes'}
              onClick={() => setNotesOpen((o) => !o)}
            >
              {lead.notes}
            </button>
          )}
        </div>
      )}
    </>
  )
}

/** Line-type chip beside the phone (story 13). Nothing rendered for unknown/absent. */
export function LineChip({ lead }: { lead: Pick<Lead, 'lineType' | 'lineCarrier'> }) {
  const style = lineTypeStyle(lead.lineType)
  if (!style) return null
  return (
    <span
      className={`line-chip line-${style.kind}`}
      style={{ marginLeft: 'var(--space-2)' }}
      title={lineTypeTooltip(lead.lineCarrier)}
    >
      {style.label}
    </span>
  )
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="fact">
      <div className="fact-label">{label}</div>
      <div className="fact-value">{children}</div>
    </div>
  )
}
