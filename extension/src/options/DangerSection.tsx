import { DEFAULT_SETTINGS } from '../shared/storage'
import { OptionsCard } from './OptionsCard'

interface Props {
  onRemoveKey: () => void
  onReset: () => void
}

/**
 * Story 17 — the only red on the page, quarantined in its own card so a
 * misclick on Remove key no longer sits two rows from a delay input.
 */
export function DangerSection({ onRemoveKey, onReset }: Props) {
  return (
    <OptionsCard title="Danger zone" danger>
      <div className="setting-row">
        <span>
          Remove the service-account key — dialing stops working until a new
          key is added
        </span>
        <button className="btn danger" onClick={onRemoveKey}>Remove key</button>
      </div>
      <div className="setting-row">
        <span>
          Reset all settings to defaults ({DEFAULT_SETTINGS.interCallDelayMs / 1000}s ·{' '}
          {DEFAULT_SETTINGS.ringingTimeoutMs / 1000}s · Uncalled only) — also
          withdraws the recording consent
        </span>
        <button className="btn danger" onClick={onReset}>Reset settings</button>
      </div>
    </OptionsCard>
  )
}
