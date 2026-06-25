import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const CACHE_DIR = join(process.cwd(), '.whois-cache')

async function defaultFetchJson(url: string): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

/** Extract the registrant's full name (vCard "fn") from an RDAP response, if present and not redacted. */
export function registrantName(rdap: any): string {
  const entities: any[] = rdap?.entities ?? []
  for (const e of entities) {
    if (!(e.roles ?? []).includes('registrant')) continue
    const vcard = e.vcardArray?.[1] ?? []
    for (const prop of vcard) {
      if (prop[0] === 'fn' && typeof prop[3] === 'string') {
        const name = prop[3].trim()
        if (name && !/redacted|privacy|private|protect|whois|domains? by proxy/i.test(name)) return name
      }
    }
  }
  return ''
}

function hostnameOf(website: string): string {
  try { return new URL(website).hostname.replace(/^www\./, '') } catch { return '' }
}

/**
 * Best-effort registrant lookup via RDAP (free, no key). Cached per-domain so
 * repeat lookups cost nothing. Returns '' when masked/unavailable.
 */
export async function whoisOwner(
  website: string,
  fetchJson: (url: string) => Promise<any> = defaultFetchJson,
): Promise<string> {
  const domain = hostnameOf(website)
  if (!domain) return ''
  const file = join(CACHE_DIR, domain.replace(/[^a-z0-9.]/gi, '_') + '.json')
  try { return JSON.parse(await readFile(file, 'utf8')) } catch { /* miss */ }

  let name = ''
  try {
    name = registrantName(await fetchJson(`https://rdap.org/domain/${domain}`))
  } catch { name = '' }

  try {
    await mkdir(CACHE_DIR, { recursive: true })
    await writeFile(file, JSON.stringify(name))
  } catch { /* ignore */ }
  return name
}
