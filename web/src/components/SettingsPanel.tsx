import { useStore } from '../lib/store'

// `shrink-0` on the track matters: in a flex row with a long label the button would
// otherwise be squashed to near-zero width and the knob would render outside it.
function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 shrink-0 rounded-full border transition ${on ? 'border-survey bg-survey/30' : 'border-line bg-ink-700'}`}
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

      <label className="flex items-start justify-between gap-3 text-sm text-parchment">
        <span className="min-w-0">
          Total results
          <span className="mt-0.5 block text-[11px] leading-snug text-muted">
            Stops the whole job once this many unique businesses are stored. Repeat
            sightings of the same place don't count towards it.
          </span>
        </span>
        <input
          type="number"
          min={1}
          value={settings.maxResults}
          onChange={(e) => setSettings({ maxResults: Number(e.target.value) })}
          className="field w-20 shrink-0 text-right font-mono"
        />
      </label>

      <div className="flex items-center justify-between text-sm text-parchment">
        <span>Scrape website <span className="text-muted">(email + socials, slower)</span></span>
        <Toggle on={settings.extractEmail} onChange={(v) => setSettings({ extractEmail: v })} />
      </div>

      <div className="flex items-center justify-between text-sm text-parchment">
        <span>Find owner <span className="text-muted">(name via site + WHOIS)</span></span>
        <Toggle on={settings.findOwner} onChange={(v) => setSettings({ findOwner: v })} />
      </div>

      <div className="flex items-center justify-between text-sm text-parchment">
        <span>Show browser</span>
        <Toggle on={!settings.headless} onChange={(v) => setSettings({ headless: !v })} />
      </div>

      <div className="space-y-3 rounded border border-line/60 bg-ink-800/40 p-3">
        <div className="flex items-start justify-between gap-3 text-sm text-parchment">
          <span className="min-w-0">
            Grid search
            <span className="mt-0.5 block text-[11px] leading-snug text-muted">
              Splits each area into map tiles. Google caps a single search at ~120
              results — tiling past that is the only way to get the rest.
            </span>
          </span>
          <Toggle on={settings.segment} onChange={(v) => setSettings({ segment: v })} />
        </div>

        {settings.segment && (
          <>
            <label className="flex items-center justify-between text-sm text-parchment">
              <span>Tile size <span className="text-muted">km</span></span>
              <input
                type="number" min={0.25} max={100} step={0.5}
                value={settings.tileKm}
                onChange={(e) => setSettings({ tileKm: Number(e.target.value) })}
                className="field w-20 text-right font-mono"
              />
            </label>
            <label className="flex items-center justify-between text-sm text-parchment">
              <span>Max tiles <span className="text-muted">per location</span></span>
              <input
                type="number" min={1} max={5000}
                value={settings.maxTiles}
                onChange={(e) => setSettings({ maxTiles: Number(e.target.value) })}
                className="field w-20 text-right font-mono"
              />
            </label>
            <p className="text-[11px] leading-snug text-muted">
              Smaller tiles find more but take longer: a 5km grid over Greater London is
              ~108 tiles. Tiles are scraped in turn until the total above is reached, so
              the grid is a ceiling on reach, not on how much gets scraped.
            </p>
          </>
        )}
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
