import { useEffect, useRef, useState } from 'react'
import { exchangeToken, parseServiceAccountKey } from '../sheets/auth'
import type { ServiceAccountKey } from '../sheets/auth'
import { clearSessionToken, keyStore } from '../shared/storage'
import { SettingsSection } from './SettingsSection'

type Status =
  | { state: 'empty' }
  | { state: 'validating' }
  | { state: 'connected'; email: string }
  | { state: 'error'; message: string }

/**
 * S0 — key setup (UX §2/S0). Validation happens on paste/drop, no Save button:
 * parse → require client_email/private_key → live token exchange.
 */
export function KeySetup() {
  const [status, setStatus] = useState<Status>({ state: 'empty' })
  const [dragging, setDragging] = useState(false)
  const [copied, setCopied] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void keyStore.get().then((key) => {
      if (key) setStatus({ state: 'connected', email: key.client_email })
    })
  }, [])

  async function validate(json: string) {
    setStatus({ state: 'validating' })
    let key: ServiceAccountKey
    try {
      key = parseServiceAccountKey(json)
    } catch (err) {
      setStatus({ state: 'error', message: err instanceof Error ? err.message : String(err) })
      return
    }
    try {
      await exchangeToken(key, Math.floor(Date.now() / 1000))
    } catch (err) {
      setStatus({ state: 'error', message: err instanceof Error ? err.message : String(err) })
      return
    }
    await keyStore.set(key)
    setStatus({ state: 'connected', email: key.client_email })
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    await validate(await file.text())
  }

  async function removeKey() {
    await keyStore.remove()
    await clearSessionToken()
    setStatus({ state: 'empty' })
  }

  async function copyEmail(email: string) {
    await navigator.clipboard.writeText(email)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  if (status.state === 'connected') {
    return (
      <div className="setup">
        <h1>Connect your Google account</h1>
        <div className="card">
          <div className="status-line ok">✓ Connected as {status.email}</div>
        </div>
        <div className="card">
          <div className="hint">Step 2 — share your spreadsheet with this email</div>
          <button
            className="chip"
            onClick={() => void copyEmail(status.email)}
            title="Copy to clipboard"
          >
            {copied ? 'Copied ✓' : `${status.email} ⧉`}
          </button>
          <a href="https://sheets.google.com" target="_blank" rel="noreferrer">
            Open Google Sheets
          </a>
        </div>
        <SettingsSection />
        <div>
          <button className="btn danger" onClick={() => void removeKey()}>
            Remove key
          </button>
        </div>
        <p className="footer-note">
          The key stays in this browser profile. Anyone using this profile can read it.
        </p>
      </div>
    )
  }

  return (
    <div className="setup">
      <h1>Connect your Google account</h1>
      <p className="intro">
        Quick Dial reads your lead sheet and writes call outcomes back. It uses a service
        account — the same one as Atlas.
      </p>

      <div
        className={`dropzone${dragging ? ' drag' : ''}`}
        onClick={() => fileInput.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          void onFile(e.dataTransfer.files[0])
        }}
      >
        {status.state === 'validating'
          ? 'Validating…'
          : 'Drop your service-account .json key here, or click to browse'}
        <input
          ref={fileInput}
          type="file"
          accept=".json,application/json"
          hidden
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
      </div>

      <textarea
        className={`keyinput${status.state === 'error' ? ' error' : ''}`}
        rows={8}
        placeholder="…or paste the key JSON here"
        onChange={(e) => {
          const text = e.target.value.trim()
          if (text) void validate(text)
        }}
      />

      {status.state === 'error' && (
        <div className="card">
          <div className="status-line bad">✗ Couldn&apos;t connect</div>
          <p className="error-text">{status.message}</p>
        </div>
      )}

      <p className="footer-note">
        The key stays in this browser profile. Anyone using this profile can read it.
      </p>
    </div>
  )
}
