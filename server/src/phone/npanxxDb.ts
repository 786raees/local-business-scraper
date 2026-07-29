import { gunzipSync } from 'node:zlib'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Lazy accessor for the committed NPA-NXX snapshot (built by
 * scripts/build-linetype-db.ts). Loaded on first lookup, never at import time,
 * and a missing/corrupt file degrades to an empty map with one warning —
 * line-type detection must never block scraping.
 */

/** 0 = wireline, 1 = wireless. VoIP is derived from the carrier by lineType.ts. */
export type PrefixRecord = [type: 0 | 1, carrier: string]

// Env override exists for tests (missing-file path) — not a user-facing knob.
// Resolved at load time, not import time, so tests can stub it.
const dataPath = (): string =>
  process.env.LINETYPE_DB_PATH
  ?? join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'npanxx.json.gz')

let map: Map<string, PrefixRecord> | null = null

function load(): Map<string, PrefixRecord> {
  if (map) return map
  map = new Map()
  const path = dataPath()
  try {
    if (!existsSync(path)) {
      console.warn(`[linetype] snapshot not found at ${path} — all numbers will classify as unknown`)
      return map
    }
    const parsed = JSON.parse(gunzipSync(readFileSync(path)).toString('utf8')) as
      Record<string, PrefixRecord | unknown>
    for (const [key, value] of Object.entries(parsed)) {
      if (key === '__meta') continue
      if (Array.isArray(value) && (value[0] === 0 || value[0] === 1)) {
        map.set(key, [value[0], String(value[1] ?? '')])
      }
    }
  } catch (err) {
    console.warn(`[linetype] failed to load snapshot (${String(err)}) — all numbers will classify as unknown`)
  }
  return map
}

/** Look up a 6-digit NPA+NXX prefix. Undefined = not in the snapshot. */
export function lookup(prefix: string): PrefixRecord | undefined {
  return load().get(prefix)
}

/** Test seam: swap the map (pass null to restore lazy file loading). */
export function _setMapForTests(next: Map<string, PrefixRecord> | null): void {
  map = next
}
