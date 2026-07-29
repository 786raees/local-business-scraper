import { useEffect, useState } from 'react'
import {
  DEFAULT_SETTINGS,
  SETTINGS_BOUNDS,
  settingsStore,
} from '../shared/storage'
import type { DialFilter, Settings } from '../shared/storage'

const FILTER_LABELS: Record<DialFilter, string> = {
  all: 'All rows',
  uncalled: 'Uncalled only',
  retry: 'Retry (No Answer + Callback)',
}

/** Dialer settings (story 11). Values clamp to SETTINGS_BOUNDS on save. */
export function SettingsSection() {
  const [settings, setSettings] = useState<Settings | null>(null)

  useEffect(() => {
    void settingsStore.get().then(setSettings)
  }, [])

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
        <span>Default dial filter</span>
        <select
          className="keyinput num"
          value={settings.dialFilter}
          onChange={(e) => void save({ dialFilter: e.target.value as DialFilter })}
        >
          {(Object.keys(FILTER_LABELS) as DialFilter[]).map((f) => (
            <option key={f} value={f}>{FILTER_LABELS[f]}</option>
          ))}
        </select>
      </label>

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
