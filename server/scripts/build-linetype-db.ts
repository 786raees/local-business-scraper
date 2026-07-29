/**
 * (Re)builds server/data/npanxx.json.gz — the offline NPA-NXX line-type snapshot.
 *
 * Sources (both public, no registration; verified reachable 2026-07-29):
 * - NPA list:  https://reports.nanpa.com/public/npa_report.csv  (NANPA public reports;
 *   rows filtered to in-service geographic US/CA area codes)
 * - Prefixes:  https://localcallingguide.com/xmlprefix.php?npa=NNN  (one XML document per
 *   NPA listing every NXX block with OCN, company name and company-type: I=ILEC, C=CLEC,
 *   W=wireless)
 *
 * Output shape (gunzipped): { __meta: {...}, [npanxx]: [t, carrier] } where t is
 * 0=wireline, 1=wireless. VoIP is NOT stored — it is derived from carrier names by
 * src/phone/lineType.ts (story 01), keeping this data dumb.
 *
 * Run: npm run linetype:build   (options: --limit N to fetch only N NPAs while testing)
 * This walks ~400 NPAs politely (sequential + delay) and takes ~15–25 minutes; the
 * committed snapshot spares everyone else from ever running it.
 */
import { gzipSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const NPA_REPORT = 'https://reports.nanpa.com/public/npa_report.csv'
const PREFIX_URL = (npa: string) => `https://localcallingguide.com/xmlprefix.php?npa=${npa}`
const OUT_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'npanxx.json.gz')
const DELAY_MS = 300

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { 'user-agent': 'atlas-linetype-build' } })
  if (!res.ok) throw new Error(`${url} -> HTTP ${res.status}`)
  return res.text()
}

/** In-service geographic US/CA NPAs from the NANPA public report. */
async function listNpas(): Promise<string[]> {
  const csv = await fetchText(NPA_REPORT)
  const npas: string[] = []
  for (const line of csv.split('\n').slice(2)) {
    const cols = line.split(',')
    const [npa, type] = cols
    const country = cols[9]?.trim()
    const inService = cols[10]?.trim()
    if (
      /^\d{3}$/.test(npa?.trim() ?? '') &&
      type?.trim() === 'General Purpose Code' &&
      inService === 'Y' &&
      (country === 'US' || country === 'CA')
    ) {
      npas.push(npa.trim())
    }
  }
  return npas
}

const FIELD = (name: string, block: string): string =>
  new RegExp(`<${name}>([^<]*)</${name}>`).exec(block)?.[1] ?? ''

const decode = (s: string): string =>
  s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')

/**
 * One NPA's prefixes. Thousand-blocks repeat per NXX; the block with x='A' is the full-code
 * holder, so it wins; otherwise the first record seen for the NXX stands.
 */
function parseNpa(xml: string, into: Record<string, [number, string]>): number {
  let added = 0
  const seenA = new Set<string>()
  for (const m of xml.matchAll(/<prefixdata>([\s\S]*?)<\/prefixdata>/g)) {
    const block = m[1]
    const npa = FIELD('npa', block)
    const nxx = FIELD('nxx', block)
    if (!/^\d{3}$/.test(npa) || !/^\d{3}$/.test(nxx)) continue
    const key = npa + nxx
    const isA = FIELD('x', block) === 'A'
    if (key in into && (seenA.has(key) || !isA)) continue
    const type = FIELD('company-type', block) === 'W' ? 1 : 0
    const carrier = decode(FIELD('company-name', block)).trim()
    if (!(key in into)) added++
    into[key] = [type, carrier]
    if (isA) seenA.add(key)
  }
  return added
}

async function main(): Promise<void> {
  const limitArg = process.argv.indexOf('--limit')
  const limit = limitArg !== -1 ? Number(process.argv[limitArg + 1]) : Infinity

  const npas = (await listNpas()).slice(0, limit)
  console.log(`NPAs to fetch: ${npas.length}`)

  const map: Record<string, [number, string]> = {}
  let failed = 0
  for (const [i, npa] of npas.entries()) {
    try {
      let xml: string
      try {
        xml = await fetchText(PREFIX_URL(npa))
      } catch {
        await sleep(2000) // one retry after a breather
        xml = await fetchText(PREFIX_URL(npa))
      }
      const added = parseNpa(xml, map)
      console.log(`[${i + 1}/${npas.length}] ${npa}: +${added} prefixes`)
    } catch (err) {
      failed++
      console.warn(`[${i + 1}/${npas.length}] ${npa}: FAILED (${String(err)}) — skipping`)
    }
    await sleep(DELAY_MS)
  }

  const meta = {
    source: `${NPA_REPORT} + localcallingguide.com/xmlprefix.php (company-type W=wireless)`,
    builtAt: new Date().toISOString(),
    npas: npas.length,
    npasFailed: failed,
    prefixes: Object.keys(map).length,
  }
  const payload = { __meta: meta, ...map }
  mkdirSync(dirname(OUT_PATH), { recursive: true })
  writeFileSync(OUT_PATH, gzipSync(JSON.stringify(payload), { level: 9 }))
  console.log(`\nwrote ${OUT_PATH}`)
  console.log(JSON.stringify(meta, null, 2))
}

main().catch((err) => {
  console.error(err)
  process.exitCode = 1
})
