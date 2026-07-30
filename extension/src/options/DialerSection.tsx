import { STATUS_FILTERS, STATUS_LABELS, criteriaSummary } from '../shared/criteria'
import { SETTINGS_BOUNDS } from '../shared/storage'
import type { DialFilter, Settings } from '../shared/storage'
import { OptionsCard } from './OptionsCard'

interface Props {
  settings: Settings
  save: (patch: Partial<Settings>) => void
}

/** Story 17 — the Dialer card: pacing + the default status axis (story 14). */
export function DialerSection({ settings, save }: Props) {
  return (
    <OptionsCard
      title="Dialer"
      description="How the session paces itself between and during calls."
    >
      <label className="setting-row">
        <span>Pause between calls — the undo window after each outcome</span>
        <span className="setting-control">
          <input
            className="keyinput num"
            type="number"
            min={SETTINGS_BOUNDS.interCallDelayMs.min / 1000}
            max={SETTINGS_BOUNDS.interCallDelayMs.max / 1000}
            value={Math.round(settings.interCallDelayMs / 1000)}
            onChange={(e) => save({ interCallDelayMs: Number(e.target.value) * 1000 })}
          />
          <span className="unit">s</span>
        </span>
      </label>

      <label className="setting-row">
        <span>Give up ringing after — hangs up and pre-selects No Answer</span>
        <span className="setting-control">
          <input
            className="keyinput num"
            type="number"
            min={SETTINGS_BOUNDS.ringingTimeoutMs.min / 1000}
            max={SETTINGS_BOUNDS.ringingTimeoutMs.max / 1000}
            value={Math.round(settings.ringingTimeoutMs / 1000)}
            onChange={(e) => save({ ringingTimeoutMs: Number(e.target.value) * 1000 })}
          />
          <span className="unit">s</span>
        </span>
      </label>

      <label className="setting-row">
        <span>Default dial status for new sessions</span>
        <span className="setting-control">
          <select
            className="keyinput num"
            value={settings.dialCriteria.status}
            onChange={(e) => save({
              // Only the status axis is edited here — the full criteria set has
              // ONE editor, the side panel's Dial filter (story 14, no drift).
              dialCriteria: {
                ...settings.dialCriteria,
                status: e.target.value as DialFilter,
              },
            })}
          >
            {STATUS_FILTERS.map((f) => (
              <option key={f} value={f}>{STATUS_LABELS[f]}</option>
            ))}
          </select>
        </span>
      </label>

      <p className="card-desc">
        Active filter: {criteriaSummary(settings.dialCriteria)} — the full set is
        edited from the side panel&apos;s Dial filter.
      </p>
    </OptionsCard>
  )
}
