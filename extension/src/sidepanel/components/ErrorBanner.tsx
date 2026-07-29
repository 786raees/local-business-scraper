import { send } from '../api'

/**
 * The fix-it pattern (UX §4.1): every error names its cause and carries the
 * one action that resolves it. Causes are classified from the error string —
 * the machine stores content-script reasons and the queue's sheet-changed
 * sentence verbatim.
 */
export function ErrorBanner({ error, onDismiss }: { error: string; onDismiss: () => void }) {
  const kind =
    error.includes('not-logged-in') || error.includes('signed out') ? 'voice-out'
    : error.includes('dialer-not-found') || error.includes('dial-failed') ? 'dialer'
    : error.includes('rows moved') ? 'resorted'
    : 'generic'

  const message =
    kind === 'voice-out' ? 'Google Voice is signed out.'
    : kind === 'dialer' ? "Can't find the dialer — Voice may have updated."
    : error

  return (
    <div className="banner-error" role="alert">
      <div className="msg">{message}</div>
      <div className="start-from-actions">
        {kind === 'voice-out' && (
          <>
            <button
              className="btn primary"
              onClick={() => void chrome.tabs.create({ url: 'https://voice.google.com/' })}
            >
              Open Voice
            </button>
            <button className="btn secondary" onClick={() => void send({ kind: 'session/start' })}>
              Resume
            </button>
          </>
        )}
        {kind === 'dialer' && (
          <button className="btn primary" onClick={() => void send({ kind: 'session/start' })}>
            Retry
          </button>
        )}
        {kind === 'resorted' && (
          <button
            className="btn primary"
            onClick={() => void send({ kind: 'session/reloadLeads' })}
          >
            Reload leads
          </button>
        )}
        {kind === 'generic' && (
          <button className="btn secondary" onClick={() => void send({ kind: 'session/start' })}>
            Retry
          </button>
        )}
        <button className="btn secondary" onClick={onDismiss}>Dismiss</button>
      </div>
    </div>
  )
}
