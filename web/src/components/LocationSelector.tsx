import { useEffect, useState } from 'react'
import { api } from '../lib/api'
import { useStore } from '../lib/store'

type Opt = { code: string; name: string }
const ALL_ZIPS = 'All zip codes'

export function LocationSelector() {
  const addLocation = useStore((s) => s.addLocation)
  const [countries, setCountries] = useState<Opt[]>([])
  const [states, setStates] = useState<Opt[]>([])
  const [cities, setCities] = useState<{ name: string }[]>([])
  const [zips, setZips] = useState<string[]>([])
  const [country, setCountry] = useState<Opt | null>(null)
  const [state, setState] = useState<Opt | null>(null)
  const [city, setCity] = useState('')
  const [zip, setZip] = useState(ALL_ZIPS)
  const [zipLoading, setZipLoading] = useState(false)
  const [checkedStates, setCheckedStates] = useState<Set<string>>(new Set())

  useEffect(() => { api.getCountries().then(setCountries) }, [])
  useEffect(() => {
    if (!country) return
    api.getStates(country.code).then(setStates)
    setState(null); setCities([]); setCity(''); setCheckedStates(new Set())
  }, [country])
  useEffect(() => {
    if (!country || !state) return
    api.getCities(country.code, state.code).then(setCities)
    setCity(''); setZips([]); setZip(ALL_ZIPS)
  }, [state])
  useEffect(() => {
    if (!country || !state || !city) { setZips([]); return }
    setZipLoading(true)
    api.getZips(country.name, state.name, city).then(setZips).finally(() => setZipLoading(false))
    setZip(ALL_ZIPS)
  }, [city])

  const addSingle = () => {
    if (!country || !state || !city) return
    const z = zip === ALL_ZIPS ? null : zip
    const label = `${country.name} › ${state.name} › ${city} › ${zip}`
    addLocation({ country: country.name, state: state.name, city, zip: z, label })
  }
  const addCheckedStates = () => {
    if (!country) return
    for (const code of checkedStates) {
      const s = states.find((x) => x.code === code)
      if (!s) continue
      addLocation({
        country: country.name, state: s.name, city: '', zip: null,
        label: `${country.name} › ${s.name} › (all cities) › All zip codes`,
      })
    }
    setCheckedStates(new Set())
  }
  const toggle = (code: string) => setCheckedStates((prev) => {
    const next = new Set(prev); next.has(code) ? next.delete(code) : next.add(code); return next
  })

  return (
    <section className="space-y-2.5">
      <h2 className="eyebrow">Add location</h2>
      <div className="grid grid-cols-2 gap-2">
        <Select label="Country" value={country?.code ?? ''}
          onChange={(v) => setCountry(countries.find((c) => c.code === v) ?? null)}
          options={countries.map((c) => ({ value: c.code, label: c.name }))} placeholder="Country" />
        <Select label="State" value={state?.code ?? ''}
          onChange={(v) => setState(states.find((s) => s.code === v) ?? null)}
          options={states.map((s) => ({ value: s.code, label: s.name }))} placeholder="State"
          disabled={!country} />
        <Select label="City" value={city} onChange={setCity}
          options={cities.map((c) => ({ value: c.name, label: c.name }))} placeholder="City"
          disabled={!state} />
        <Select label="Zip" value={zip} onChange={setZip}
          options={[{ value: ALL_ZIPS, label: zipLoading ? 'Loading…' : ALL_ZIPS },
            ...zips.map((z) => ({ value: z, label: z }))]}
          disabled={!city} mono />
      </div>

      <button
        onClick={addSingle}
        disabled={!city}
        className="w-full rounded-md bg-survey/90 py-1.5 text-sm font-600 text-ink-900 transition hover:bg-survey
                   disabled:cursor-not-allowed disabled:bg-ink-600 disabled:text-muted"
      >
        Plot location
      </button>

      {states.length > 0 && (
        <details className="rounded-md border border-line bg-ink-700/40">
          <summary className="cursor-pointer px-2.5 py-1.5 text-xs text-muted transition hover:text-parchment">
            Or select multiple states
          </summary>
          <div className="border-t border-line p-2">
            <div className="max-h-40 overflow-y-auto pr-1">
              {states.map((s) => (
                <label key={s.code} className="flex items-center gap-2 py-0.5 text-xs text-parchment">
                  <input type="checkbox" checked={checkedStates.has(s.code)} onChange={() => toggle(s.code)}
                    className="accent-survey" />
                  {s.name}
                </label>
              ))}
            </div>
            <div className="mt-2 flex gap-1.5">
              <button onClick={() => setCheckedStates(new Set(states.map((s) => s.code)))}
                className="rounded border border-line px-2 py-1 text-[11px] text-muted hover:text-parchment">Select all</button>
              <button onClick={() => setCheckedStates(new Set())}
                className="rounded border border-line px-2 py-1 text-[11px] text-muted hover:text-parchment">Clear</button>
              <button onClick={addCheckedStates} disabled={!checkedStates.size}
                className="ml-auto rounded bg-survey/90 px-2 py-1 text-[11px] font-600 text-ink-900 hover:bg-survey disabled:opacity-40">
                Plot {checkedStates.size || ''} states
              </button>
            </div>
          </div>
        </details>
      )}
    </section>
  )
}

function Select({ value, onChange, options, placeholder, disabled, mono }: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  placeholder?: string
  disabled?: boolean
  mono?: boolean
}) {
  return (
    <select
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      className={`field cursor-pointer disabled:cursor-not-allowed disabled:opacity-50 ${mono ? 'font-mono' : ''}`}
    >
      {placeholder && <option value="">{placeholder}</option>}
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}
