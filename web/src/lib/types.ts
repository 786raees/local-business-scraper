export interface LocationSpec {
  country: string
  state: string
  city: string
  zip: string | null
  label: string
}

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
  /**
   * 'mobile' | 'landline' | 'voip' | 'unknown' — derived offline from the phone's
   * NPA-NXX prefix (original carrier assignment; ported numbers may differ).
   * '' on rows that predate the feature and haven't been backfilled.
   */
  lineType: string
  lineCarrier: string
}

export const SOCIAL_FIELDS = [
  ['facebook', 'FB'], ['instagram', 'IG'], ['twitter', 'X'], ['linkedin', 'IN'],
  ['youtube', 'YT'], ['tiktok', 'TT'], ['yelp', 'Yelp'], ['yellowpages', 'YP'],
] as const

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

export interface ResultQuery {
  q?: string
  category?: string
  minRating?: number
  minReviews?: number
  hasEmail?: boolean
  hasWebsite?: boolean
  hasPhone?: boolean
  /** 'mobile' | 'landline' | 'voip' | 'unknown' ('unknown' also matches unbackfilled ''). */
  lineType?: string
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

/** Error body returned by the /api/sheets/* routes. */
export interface SheetsErrorBody {
  error: string
  shareWith?: string
}

/** One destination tab in a (possibly split) export. */
export interface ExportTarget {
  sheetTitle: string
  createNew?: boolean
  /** Integer share of the exported rows. All targets must sum to exactly 100. */
  percent: number
}

/** Per-tab outcome of a split export. */
export interface TabExportSummary {
  sheetTitle: string
  appended: number
  skipped: number
}

/** Outcome of a split export. `total` is rows in the export scope. */
export interface SplitExportResult {
  perTab: TabExportSummary[]
  total: number
}
