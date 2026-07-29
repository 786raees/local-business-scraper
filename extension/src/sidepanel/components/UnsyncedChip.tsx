import { useEffect, useState } from 'react'
import { send } from '../api'
import { timeAgo } from '../../shared/format'
import { keyStore } from '../../shared/storage'
import type { CallOutcome } from '../../shared/types'

interface QueueRow {
  id: string
  leadName: string
  outcome: CallOutcome
  ts: number
}

/**
 * The unsynced-writes chip + popover (UX §4.1, DESIGN §6.7). Amber count while
 * retryable; the 403-paused state swaps Retry for the share-fix copy chip.
 */
export function UnsyncedChip({ count, paused }: { count: number; paused?: boolean }) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<QueueRow[]>([])
  const [email, setEmail] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return
    void send<QueueRow[]>({ kind: 'queue/list' }).then((r) => { if (r.ok) setRows(r.data) })
    void keyStore.get().then((k) => setEmail(k?.client_email ?? ''))
  }, [open, count])

  if (count === 0 && !paused) return null

  return (
    <div className="unsynced">
      <button className="chip unsynced-chip" onClick={() => setOpen((o) => !o)}>
        <span className="dot ringing" /> {count} unsynced
      </button>
      {open && (
        <div className="queue-popover">
          {rows.map((r) => (
            <div key={r.id} className="queue-row">
              <span className="row-name">{r.leadName}</span>
              <span className="row-sub">{r.outcome} · {timeAgo(new Date(r.ts).toISOString())}</span>
            </div>
          ))}
          {paused ? (
            <>
              <div className="row-sub bad">
                Sheet access denied — share it with the service account, then retry.
              </div>
              {email && (
                <button
                  className="chip"
                  onClick={() => void navigator.clipboard.writeText(email).then(() => {
                    setCopied(true)
                    setTimeout(() => setCopied(false), 1500)
                  })}
                >
                  {copied ? 'Copied ✓' : `${email} ⧉`}
                </button>
              )}
            </>
          ) : null}
          <button
            className="btn secondary"
            onClick={() => void send({ kind: 'queue/retry' }).then(() => setOpen(false))}
          >
            Retry now
          </button>
        </div>
      )}
    </div>
  )
}
