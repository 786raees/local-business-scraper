import { useEffect, useState } from 'react'
import { send } from '../api'
import type { ContentToBg } from '../../shared/messages'

/**
 * Story 06 dev harness — drives dial/hangUp/probe before the session loop
 * exists. Hidden unless a dev build or localStorage['gvqd-dev'] === '1'.
 * Removed when story 07's loop lands.
 */
export function DevHarness() {
  const [phone, setPhone] = useState('')
  const [log, setLog] = useState<string[]>([])

  const append = (line: string) =>
    setLog((l) => [...l.slice(-6), line])

  useEffect(() => {
    const onMsg = (msg: ContentToBg) => {
      if (msg.kind === 'voice/callState') append(`state: ${msg.state}`)
      if (msg.kind === 'voice/error') append(`error: ${msg.reason}`)
    }
    chrome.runtime.onMessage.addListener(onMsg)
    return () => chrome.runtime.onMessage.removeListener(onMsg)
  }, [])

  if (!import.meta.env.DEV && localStorage.getItem('gvqd-dev') !== '1') return null

  return (
    <div className="center-card" style={{ borderStyle: 'dashed' }}>
      <div className="section-caption" style={{ padding: 0 }}>Dev harness</div>
      <input
        className="search"
        style={{ margin: 0 }}
        placeholder="Phone number to test-dial"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
      />
      <div className="start-from-actions">
        <button
          className="btn secondary"
          disabled={!phone.trim()}
          onClick={() => void send({ kind: 'dev/voiceDial', phone: phone.trim() })
            .then((r) => append(r.ok ? 'dial sent' : `dial failed: ${r.error}`))}
        >
          Dial
        </button>
        <button
          className="btn secondary"
          onClick={() => void send({ kind: 'dev/voiceHangUp' })
            .then((r) => append(r.ok ? 'hangup sent' : `hangup failed: ${r.error}`))}
        >
          Hang up
        </button>
        <button
          className="btn secondary"
          onClick={() => void send<{ state: string; loggedOut: boolean }>({ kind: 'dev/voiceProbe' })
            .then((r) => append(r.ok
              ? `probe: ${r.data.state}${r.data.loggedOut ? ' (logged out)' : ''}`
              : `probe failed: ${r.error}`))}
        >
          Probe
        </button>
      </div>
      {log.length > 0 && (
        <pre style={{ font: 'var(--type-caption)', color: 'var(--text-muted)', margin: 0 }}>
          {log.join('\n')}
        </pre>
      )}
    </div>
  )
}
