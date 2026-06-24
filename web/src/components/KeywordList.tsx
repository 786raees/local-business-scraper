import { useState } from 'react'
import { useStore } from '../lib/store'

export function KeywordList() {
  const { keywords, addKeyword, removeKeyword } = useStore()
  const [val, setVal] = useState('')
  const commit = () => { addKeyword(val); setVal('') }

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="eyebrow">Keywords</h2>
        <span className="font-mono text-[10px] text-muted">{keywords.length}</span>
      </div>
      <div className="flex gap-2">
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') commit() }}
          placeholder="plumber, roofer…"
          className="field"
        />
        <button
          onClick={commit}
          className="shrink-0 rounded-md border border-line px-2.5 text-sm text-parchment transition hover:border-survey hover:text-survey"
        >
          Add
        </button>
      </div>
      <ul className="mt-2 flex flex-wrap gap-1.5">
        {keywords.map((k) => (
          <li
            key={k}
            className="group inline-flex items-center gap-1.5 rounded-md border border-line bg-ink-700 px-2 py-1 text-xs"
          >
            <span className="text-parchment">{k}</span>
            <button
              onClick={() => removeKeyword(k)}
              aria-label={`Remove ${k}`}
              className="text-muted transition hover:text-rose"
            >
              ✕
            </button>
          </li>
        ))}
        {!keywords.length && <li className="text-xs text-muted/70">No keywords yet.</li>}
      </ul>
    </section>
  )
}
