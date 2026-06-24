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

export async function lookupZips(
  country: string,
  state: string,
  city: string,
  fetchJson: (url: string) => Promise<any> = defaultFetchJson,
): Promise<string[]> {
  const file = join(CACHE_DIR, cacheKey(country, state, city))
  try {
    const cached = await readFile(file, 'utf8')
    return JSON.parse(cached)
  } catch { /* cache miss */ }

  let zips: string[] = []
  try {
    // Zippopotam by country+state+city.
    const url = `https://api.zippopotam.us/${country}/${encodeURIComponent(state)}/${encodeURIComponent(city)}`
    const data = await fetchJson(url)
    const places = (data?.places ?? []) as Array<Record<string, string>>
    zips = places.map((p) => p['post code']).filter(Boolean)
  } catch {
    zips = []
  }
  zips = [...new Set(zips)].sort()

  if (zips.length) {
    try {
      await mkdir(CACHE_DIR, { recursive: true })
      await writeFile(file, JSON.stringify(zips))
    } catch { /* ignore cache write failure */ }
  }
  return zips
}
