import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { LocationSpec } from '../types.js'
import { BBox } from './grid.js'

const CACHE_DIR = join(process.cwd(), '.geocode-cache')

// Nominatim's usage policy requires a User-Agent identifying the application, and
// tolerates about one request per second. Results are cached to disk so a repeated
// job geocodes each area once, ever.
const USER_AGENT = 'Atlas-Maps-Scraper/0.1 (local research tool)'
const MIN_INTERVAL_MS = 1100

export interface GeoArea {
  lat: number
  lng: number
  bbox: BBox
  displayName: string
}

export type FetchJson = (url: string, init?: { headers: Record<string, string> }) => Promise<any>

let lastCall = 0
async function defaultFetchJson(url: string, init?: { headers: Record<string, string> }) {
  const wait = MIN_INTERVAL_MS - (Date.now() - lastCall)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastCall = Date.now()
  const res = await fetch(url, init)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

function cacheKey(query: string): string {
  return query.replace(/[^a-z0-9]+/gi, '-').toLowerCase().slice(0, 120) + '.json'
}

/** Resolve a free-text place name to its centre and bounding box via OpenStreetMap. */
export async function geocode(
  query: string,
  fetchJson: FetchJson = defaultFetchJson,
  cacheDir: string = CACHE_DIR,
): Promise<GeoArea | null> {
  return geocodeParams({ q: query }, fetchJson, cacheDir)
}

/**
 * Resolve using Nominatim's structured parameters.
 *
 * Strongly preferred over free-text: "Berlin, Berlin, Germany" as `q` returns a street
 * in Charlottenburg and "Madrid, Madrid, Spain" returns the national library, both of
 * which tile down to a single useless viewport. The structured form returns the
 * administrative boundary.
 */
export async function geocodeParams(
  params: Record<string, string>,
  fetchJson: FetchJson = defaultFetchJson,
  cacheDir: string = CACHE_DIR,
): Promise<GeoArea | null> {
  const search = new URLSearchParams({ ...params, format: 'json', limit: '1' })
  const file = join(cacheDir, cacheKey(Object.values(params).join('-')))
  try {
    return JSON.parse(await readFile(file, 'utf8')) as GeoArea
  } catch { /* cache miss */ }

  let area: GeoArea | null = null
  try {
    const url = `https://nominatim.openstreetmap.org/search?${search}`
    const data = await fetchJson(url, { headers: { 'User-Agent': USER_AGENT } })
    const hit = Array.isArray(data) ? data[0] : null
    if (hit?.boundingbox?.length === 4) {
      // Nominatim orders boundingbox as [south, north, west, east].
      const [south, north, west, east] = hit.boundingbox.map(Number)
      area = {
        lat: Number(hit.lat),
        lng: Number(hit.lon),
        bbox: { south, north, west, east },
        displayName: String(hit.display_name ?? Object.values(params).join(', ')),
      }
    }
  } catch {
    area = null
  }

  // Only successes are cached — a network blip must not poison the cache forever.
  if (area) {
    try {
      await mkdir(cacheDir, { recursive: true })
      await writeFile(file, JSON.stringify(area))
    } catch { /* ignore cache write failure */ }
  }
  return area
}

/** Geocode a LocationSpec, using the most specific parts the user selected. */
export async function areaFromLocation(
  loc: LocationSpec,
  fetchJson: FetchJson = defaultFetchJson,
  cacheDir: string = CACHE_DIR,
): Promise<GeoArea | null> {
  const params: Record<string, string> = {}
  if (loc.country) params.country = loc.country
  if (loc.city) params.city = loc.city
  // City-states repeat the name at both levels ("Berlin, Berlin"), which Nominatim
  // resolves to a street rather than the city. Drop the redundant half.
  if (loc.state && loc.state.toLowerCase() !== loc.city.toLowerCase()) params.state = loc.state
  if (loc.zip) params.postalcode = loc.zip
  return geocodeParams(params, fetchJson, cacheDir)
}
