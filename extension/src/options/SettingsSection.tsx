import { useEffect, useState } from 'react'
import { STATUS_FILTERS, STATUS_LABELS, criteriaSummary } from '../shared/criteria'
import {
  DEFAULT_SETTINGS,
  SETTINGS_BOUNDS,
  settingsStore,
} from '../shared/storage'
import type { DialFilter, Settings } from '../shared/storage'

type MicState = 'granted' | 'denied' | 'prompt'

/** Dialer settings (story 11). Values clamp to SETTINGS_BOUNDS on save. */
export function SettingsSection() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [mic, setMic] = useState<MicState | null>(null)

  useEffect(() => {
    void settingsStore.get().then(setSettings)
    // The offscreen recorder CANNOT show a permission prompt — getUserMedia
    // auto-rejects there unless mic access was already granted from a visible
    // extension page. This page is where that one-time grant happens.
    void navigator.permissions
      .query({ name: 'microphone' as PermissionName })
      .then((p) => {
        setMic(p.state as MicState)
        p.onchange = () => setMic(p.state as MicState)
      })
      .catch(() => setMic('prompt'))
  }, [])

  async function grantMic() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      stream.getTracks().forEach((t) => t.stop())
      setMic('granted')
    } catch {
      setMic('denied')
    }
  }

  if (!settings) return null

  async function save(patch: Partial<Settings>) {
    setSettings(await settingsStore.set(patch))
  }

  return (
    <div className="card">
      <div className="hint">Dialer settings</div>

      <label className="setting-row">
        <span>Pause between calls (seconds)</span>
        <input
          className="keyinput num"
          type="number"
          min={SETTINGS_BOUNDS.interCallDelayMs.min / 1000}
          max={SETTINGS_BOUNDS.interCallDelayMs.max / 1000}
          value={Math.round(settings.interCallDelayMs / 1000)}
          onChange={(e) => void save({ interCallDelayMs: Number(e.target.value) * 1000 })}
        />
      </label>

      <label className="setting-row">
        <span>Give up ringing after (seconds)</span>
        <input
          className="keyinput num"
          type="number"
          min={SETTINGS_BOUNDS.ringingTimeoutMs.min / 1000}
          max={SETTINGS_BOUNDS.ringingTimeoutMs.max / 1000}
          value={Math.round(settings.ringingTimeoutMs / 1000)}
          onChange={(e) => void save({ ringingTimeoutMs: Number(e.target.value) * 1000 })}
        />
      </label>

      <label className="setting-row">
        <span>Default dial status</span>
        <select
          className="keyinput num"
          value={settings.dialCriteria.status}
          onChange={(e) => void save({
            // Only the status axis is edited here — the full criteria set has
            // ONE editor, the side panel's Dial filter (story 14, no drift).
            dialCriteria: { ...settings.dialCriteria, status: e.target.value as DialFilter },
          })}
        >
          {STATUS_FILTERS.map((f) => (
            <option key={f} value={f}>{STATUS_LABELS[f]}</option>
          ))}
        </select>
      </label>

      <div className="hint" style={{ marginTop: 0 }}>
        Active filter: {criteriaSummary(settings.dialCriteria)} — edit the full
        set from the side panel&apos;s Dial filter.
      </div>

      <div className="hint" style={{ marginTop: 8 }}>Call recording</div>

      <label className="setting-row">
        <span>
          I am responsible for complying with call recording laws in my
          jurisdiction (many require all-party consent). The extension records
          silently — announcing the recording is my obligation.
        </span>
        <input
          type="checkbox"
          checked={!!settings.recordingConsentAt}
          onChange={(e) => void save(
            e.target.checked
              ? { recordingConsentAt: new Date().toISOString() }
              // Withdrawing consent also forces recording off (clampSettings).
              : { recordingConsentAt: undefined, recordingEnabled: false },
          )}
        />
      </label>

      <div className="setting-row">
        <span>
          Microphone access — required once, from this page (Chrome cannot ask
          during a call; without it every recording fails)
        </span>
        {mic === 'granted' ? (
          <span className="status-line ok">✓ Granted</span>
        ) : (
          <button className="btn secondary" onClick={() => void grantMic()}>
            {mic === 'denied' ? 'Blocked — click to retry' : 'Enable microphone'}
          </button>
        )}
      </div>
      {mic === 'denied' && (
        <p className="error-text">
          Chrome has the microphone blocked for this extension. Click the
          camera/mic icon in the address bar (or Site settings) to allow it,
          then retry.
        </p>
      )}

      <label className="setting-row">
        <span>
          Record calls (saved to Downloads/gv-quick-dial, filename logged into
          the row&apos;s Notes)
        </span>
        <input
          type="checkbox"
          disabled={!settings.recordingConsentAt}
          checked={settings.recordingEnabled}
          onChange={(e) => void save({ recordingEnabled: e.target.checked })}
        />
      </label>

      {settings.recordingEnabled && (
        <label className="setting-row">
          <span>Discard recordings shorter than (seconds, 0 = keep all)</span>
          <input
            className="keyinput num"
            type="number"
            min={SETTINGS_BOUNDS.recordingMinSeconds.min}
            max={SETTINGS_BOUNDS.recordingMinSeconds.max}
            value={settings.recordingMinSeconds}
            onChange={(e) => void save({ recordingMinSeconds: Number(e.target.value) })}
          />
        </label>
      )}

      <div>
        <button
          className="btn secondary"
          onClick={() => void settingsStore.reset().then(setSettings)}
        >
          Reset to defaults ({DEFAULT_SETTINGS.interCallDelayMs / 1000}s ·{' '}
          {DEFAULT_SETTINGS.ringingTimeoutMs / 1000}s · Uncalled only)
        </button>
      </div>
    </div>
  )
}
