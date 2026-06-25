import nlp from 'compromise'

// Role keywords that typically sit next to an owner's name on a website.
const TITLES = [
  'co-owner', 'owner', 'co-founder', 'founder', 'ceo', 'president',
  'proprietor', 'principal', 'managing director', 'managing partner',
]
const BY_PHRASES = ['owned by', 'founded by', 'established by', 'started by']

/** First plausible 2–3 word person name in a text window, title-cased. */
function personIn(window: string): string | null {
  const people = nlp(window).people().out('array') as string[]
  for (const p of people) {
    const words = p.trim().replace(/[^\w\s.'-]/g, '').split(/\s+/)
      // drop a trailing sentence period but keep single-letter initials ("J.")
      .map((w) => (w.length > 2 ? w.replace(/\.+$/, '') : w))
      .filter(Boolean)
    if (words.length >= 2 && words.length <= 3) {
      return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
    }
  }
  return null
}

function* indexesOf(haystack: string, needle: string): Generator<number> {
  let i = haystack.indexOf(needle)
  while (i >= 0) { yield i; i = haystack.indexOf(needle, i + 1) }
}

/**
 * Best-effort owner/founder extraction from website page text. Free and offline:
 * find a role keyword, then pull the nearest person name via NLP. Returns null
 * when nothing confident is found.
 */
export function extractOwner(text: string): { name: string; title: string } | null {
  if (!text) return null
  const clean = text.replace(/\s+/g, ' ')
  const lower = clean.toLowerCase()

  for (const title of TITLES) {
    for (const idx of indexesOf(lower, title)) {
      const window = clean.slice(Math.max(0, idx - 45), idx + title.length + 45)
      const name = personIn(window)
      if (name) return { name, title: titleCase(title) }
    }
  }

  for (const phrase of BY_PHRASES) {
    const idx = lower.indexOf(phrase)
    if (idx >= 0) {
      const name = personIn(clean.slice(idx, idx + 60))
      if (name) return { name, title: 'Owner' }
    }
  }

  return null
}

function titleCase(s: string): string {
  return s.replace(/\b\w/g, (c) => c.toUpperCase())
}
