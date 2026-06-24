import { useStore } from '../lib/store'

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 rounded-full border transition ${on ? 'border-survey bg-survey/30' : 'border-line bg-ink-700'}`}
    >
      <span
        className={`absolute top-0.5 h-3.5 w-3.5 rounded-full transition-all ${on ? 'left-[18px] bg-survey' : 'left-0.5 bg-muted'}`}
      />
    </button>
  )
}

export function SettingsPanel() {
  const { settings, setSettings } = useStore()
  return (
    <section className="space-y-3">
      <h2 className="eyebrow">Survey parameters</h2>

      <label className="flex items-center justify-between text-sm text-parchment">
        Max results / task
        <input
          type="number"
          min={1}
          value={settings.maxResults}
          onChange={(e) => setSettings({ maxResults: Number(e.target.value) })}
          className="field w-20 text-right font-mono"
        />
      </label>

      <div className="flex items-center justify-between text-sm text-parchment">
        <span>Extract email <span className="text-muted">(slower)</span></span>
        <Toggle on={settings.extractEmail} onChange={(v) => setSettings({ extractEmail: v })} />
      </div>

      <div className="flex items-center justify-between text-sm text-parchment">
        <span>Show browser</span>
        <Toggle on={!settings.headless} onChange={(v) => setSettings({ headless: !v })} />
      </div>

      <div className="flex items-center justify-between text-sm text-parchment">
        <span>Delay <span className="text-muted">min / max ms</span></span>
        <span className="flex gap-1">
          <input
            type="number" value={settings.delayMinMs}
            onChange={(e) => setSettings({ delayMinMs: Number(e.target.value) })}
            className="field w-16 text-right font-mono"
          />
          <input
            type="number" value={settings.delayMaxMs}
            onChange={(e) => setSettings({ delayMaxMs: Number(e.target.value) })}
            className="field w-16 text-right font-mono"
          />
        </span>
      </div>
    </section>
  )
}
