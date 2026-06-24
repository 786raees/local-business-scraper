import { useStore } from '../lib/store'

export function LocationList() {
  const { locations, removeLocation } = useStore()
  if (!locations.length) return null
  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="eyebrow">Plotted locations</h2>
        <span className="font-mono text-[10px] text-muted">{locations.length}</span>
      </div>
      <ul className="space-y-1.5">
        {locations.map((l) => (
          <li
            key={l.label}
            className="group flex items-center gap-2 rounded-md border border-line bg-ink-700 px-2 py-1.5"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" className="shrink-0" aria-hidden>
              <path d="M12 22s7-6.4 7-12a7 7 0 1 0-14 0c0 5.6 7 12 7 12Z" fill="#3FB9A6" />
              <circle cx="12" cy="10" r="2.4" fill="#0B1322" />
            </svg>
            <span className="flex-1 truncate font-mono text-[11px] text-parchment" title={l.label}>{l.label}</span>
            <button
              onClick={() => removeLocation(l.label)}
              aria-label={`Remove ${l.label}`}
              className="text-muted opacity-0 transition group-hover:opacity-100 hover:text-rose"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}
