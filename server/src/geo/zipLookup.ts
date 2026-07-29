import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const CACHE_DIR = join(process.cwd(), '.geo-cache')

async function defaultFetchJson(url: string): Promise<any> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

function cacheKey(country: string, state: string, city: string): string {
  return `${country}_${state}_${city}`.replace(/[^a-z0-9_]/gi, '-').toLowerCase() + '.json'
}

// country-state-city lists administrative areas next to real cities — "Greater London",
// "Aberdeen City", "City of Westminster". Zippopotam only indexes the bare place name, so
// those return nothing verbatim. Derive the bare name to retry with.
function nameVariants(city: string): string[] {
  const stripped = city
    .replace(/^(Greater|City of|County of|Borough of|Royal Borough of)\s+/i, '')
    .replace(/\s+(City|County|District|Borough|Council|Metropolitan Borough)$/i, '')
    .trim()
  return stripped && stripped.toLowerCase() !== city.toLowerCase() ? [city, stripped] : [city]
}

export async function lookupZips(
  country: string,
  state: string,
  city: string,
  fetchJson: (url: string) => Promise<any> = defaultFetchJson,
  cacheDir: string = CACHE_DIR,
): Promise<string[]> {
  const file = join(cacheDir, cacheKey(country, state, city))
  try {
    const cached = await readFile(file, 'utf8')
    return JSON.parse(cached)
  } catch { /* cache miss */ }

  let zips: string[] = []
  for (const name of nameVariants(city)) {
    try {
      // Zippopotam expects a lowercase 2-letter country code and state abbreviation,
      // e.g. https://api.zippopotam.us/us/fl/miami
      const url = `https://api.zippopotam.us/${country.toLowerCase()}/${encodeURIComponent(state.toLowerCase())}/${encodeURIComponent(name)}`
      const data = await fetchJson(url)
      const places = (data?.places ?? []) as Array<Record<string, string>>
      zips = places.map((p) => p['post code']).filter(Boolean)
    } catch {
      zips = []
    }
    if (zips.length) break
  }
  zips = [...new Set(zips)].sort()

  if (zips.length) {
    try {
      await mkdir(cacheDir, { recursive: true })
      await writeFile(file, JSON.stringify(zips))
    } catch { /* ignore cache write failure */ }
  }
  return zips
}
