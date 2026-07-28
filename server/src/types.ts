export interface LocationSpec {
  country: string
  state: string
  city: string
  zip: string | null
  label: string
}

export const SOCIAL_PLATFORMS = [
  'facebook', 'instagram', 'twitter', 'linkedin', 'youtube', 'tiktok', 'yelp', 'yellowpages',
] as const
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number]
export type Socials = Record<SocialPlatform, string>

export interface Business {
  /** Google's canonical place id — the dedup key across overlapping grid tiles. */
  placeId: string
  name: string
  address: string
  phone: string
  website: string
  rating: number | null
  reviewCount: number | null
  priceLevel: string
  category: string
  hours: string
  email: string
  mapsUrl: string
  keyword: string
  location: string
  facebook: string
  instagram: string
  twitter: string
  linkedin: string
  youtube: string
  tiktok: string
  yelp: string
  yellowpages: string
  ownerName: string
  ownerTitle: string
  ownerSource: string
}

export interface JobSettings {
  /**
   * Whole-job budget: the run stops once this many *unique* businesses are stored,
   * leaving any remaining tiles unvisited. Duplicate sightings do not consume it.
   */
  maxResults: number
  extractEmail: boolean
  findOwner: boolean
  headless: boolean
  delayMinMs: number
  delayMaxMs: number
  /** Divide each location into a grid of map viewports to break Google's ~120/search cap. */
  segment: boolean
  /** Width/height of each grid tile in km. Smaller = more tiles = deeper coverage. */
  tileKm: number
  /** Hard ceiling on tiles per location, so a large area cannot flood the queue. */
  maxTiles: number
}

/** A map viewport to anchor a search to. Mirrors server/src/geo/grid.ts. */
export interface Viewport {
  lat: number
  lng: number
  zoom: number
}

export const DEFAULT_SETTINGS: JobSettings = {
  maxResults: 60,
  extractEmail: false,
  findOwner: false,
  headless: true,
  delayMinMs: 800,
  delayMaxMs: 2200,
  segment: false,
  tileKm: 5,
  maxTiles: 400,
}

/**
 * Coerce and clamp a settings object arriving from the client.
 * Without this, `{ segment: true }` with no tileKm reaches tileGrid as undefined and
 * throws, killing the whole job rather than scraping anything.
 */
export function normalizeSettings(raw: Partial<JobSettings> = {}): JobSettings {
  const num = (v: unknown, fallback: number, lo: number, hi: number): number => {
    const n = Number(v)
    if (!Number.isFinite(n)) return fallback
    return Math.min(hi, Math.max(lo, n))
  }
  const bool = (v: unknown, fallback: boolean): boolean =>
    typeof v === 'boolean' ? v : fallback

  const delayMinMs = num(raw.delayMinMs, DEFAULT_SETTINGS.delayMinMs, 0, 60_000)
  const delayMaxMs = num(raw.delayMaxMs, DEFAULT_SETTINGS.delayMaxMs, 0, 60_000)

  return {
    maxResults: num(raw.maxResults, DEFAULT_SETTINGS.maxResults, 1, 100_000),
    extractEmail: bool(raw.extractEmail, DEFAULT_SETTINGS.extractEmail),
    findOwner: bool(raw.findOwner, DEFAULT_SETTINGS.findOwner),
    headless: bool(raw.headless, DEFAULT_SETTINGS.headless),
    // An inverted range is a UI slip, not a reason to fail — order it instead.
    delayMinMs: Math.min(delayMinMs, delayMaxMs),
    delayMaxMs: Math.max(delayMinMs, delayMaxMs),
    segment: bool(raw.segment, DEFAULT_SETTINGS.segment),
    tileKm: num(raw.tileKm, DEFAULT_SETTINGS.tileKm, 0.25, 100),
    maxTiles: num(raw.maxTiles, DEFAULT_SETTINGS.maxTiles, 1, 5000),
  }
}

export interface TaskSpec {
  id: string
  keyword: string
  location: LocationSpec
  /** Present when this task is one tile of a segmented location. */
  viewport?: Viewport
  /** Human-readable name for the queue panel, e.g. "dentist — London (3/108)". */
  label: string
}

export interface ResultQuery {
  q?: string
  category?: string
  minRating?: number
  minReviews?: number
  hasEmail?: boolean
  hasWebsite?: boolean
  hasPhone?: boolean
  sortBy?: string
  sortDir?: 'asc' | 'desc'
}

export type TaskStatus = 'queued' | 'running' | 'done' | 'error' | 'blocked'

export type JobEvent =
  | { type: 'task-update'; taskId: string; status: TaskStatus; count?: number; error?: string; label?: string }
  | { type: 'row'; business: Business }
  | { type: 'count'; total: number; duplicates?: number }
  | { type: 'progress'; done: number; total: number }
  | { type: 'job-done' }

export function emptyBusiness(keyword: string, location: string): Business {
  return {
    placeId: '',
    name: '', address: '', phone: '', website: '', rating: null, reviewCount: null,
    priceLevel: '', category: '', hours: '', email: '', mapsUrl: '', keyword, location,
    facebook: '', instagram: '', twitter: '', linkedin: '', youtube: '', tiktok: '',
    yelp: '', yellowpages: '',
    ownerName: '', ownerTitle: '', ownerSource: '',
  }
}

/** A spreadsheet the service account can see (i.e. one shared with it). */
export interface SpreadsheetRef {
  id: string
  name: string
}

/** A tab within a spreadsheet. */
export interface TabRef {
  sheetId: number
  title: string
  rowCount: number
}

/** Outcome of a Sheets export. `total` is rows considered, not rows written. */
export interface ExportResult {
  appended: number
  skipped: number
  total: number
}
