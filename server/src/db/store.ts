import { createRequire } from 'node:module'
import { Business, ResultQuery } from '../types.js'

// node:sqlite is a runtime builtin; load via require so bundlers (vitest/vite)
// don't try to statically resolve it.
const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')

type Db = InstanceType<typeof DatabaseSync>
type Stmt = ReturnType<Db['prepare']>

const COLUMNS: (keyof Business)[] = [
  'placeId',
  'name', 'address', 'phone', 'website', 'rating', 'reviewCount', 'priceLevel',
  'category', 'hours', 'email', 'mapsUrl', 'keyword', 'location',
  'facebook', 'instagram', 'twitter', 'linkedin', 'youtube', 'tiktok', 'yelp', 'yellowpages',
  'ownerName', 'ownerTitle', 'ownerSource',
  'lineType', 'lineCarrier',
]

// Columns merged numerically rather than as text when a duplicate place is re-seen.
const NUMERIC = new Set<string>(['rating', 'reviewCount'])

// Columns the client is allowed to sort by (prevents SQL injection via sortBy).
const SORTABLE = new Set<string>([
  'name', 'rating', 'reviewCount', 'category', 'address', 'phone', 'email', 'location', 'ownerName',
  'lineType',
])

/**
 * Disk-backed results store. Holds every scraped row so the frontend never
 * needs all of them in memory and CSV export can stream from disk.
 * Pass ':memory:' in tests.
 */
export class ResultsStore {
  // DatabaseSync is a runtime value from node:sqlite, so its type has to be derived
  // from it rather than referenced directly.
  private db: Db
  private insertStmt: Stmt
  private mergeStmt: Stmt
  private hasStmt: Stmt

  constructor(path = 'results.db') {
    this.db = new DatabaseSync(path)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        placeId TEXT,
        name TEXT, address TEXT, phone TEXT, website TEXT,
        rating REAL, reviewCount INTEGER, priceLevel TEXT,
        category TEXT, hours TEXT, email TEXT, mapsUrl TEXT,
        keyword TEXT, location TEXT,
        facebook TEXT, instagram TEXT, twitter TEXT, linkedin TEXT,
        youtube TEXT, tiktok TEXT, yelp TEXT, yellowpages TEXT,
        ownerName TEXT, ownerTitle TEXT, ownerSource TEXT,
        lineType TEXT, lineCarrier TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_results_name ON results(name);
    `)
    // Migrate older DBs that predate the social/owner columns.
    const existing = new Set(
      (this.db.prepare('PRAGMA table_info(results)').all() as { name: string }[]).map((c) => c.name),
    )
    const added = [
      'facebook', 'instagram', 'twitter', 'linkedin', 'youtube', 'tiktok', 'yelp', 'yellowpages',
      'ownerName', 'ownerTitle', 'ownerSource', 'placeId',
      'lineType', 'lineCarrier',
    ]
    for (const col of added) {
      if (!existing.has(col)) this.db.exec(`ALTER TABLE results ADD COLUMN ${col} TEXT`)
    }
    // Dedup key. Rows with no place id store NULL, and SQLite treats NULLs as distinct,
    // so unidentifiable rows are never collapsed into each other.
    this.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_results_placeid ON results(placeId)')

    const cols = COLUMNS.join(', ')
    const placeholders = COLUMNS.map(() => '?').join(', ')
    this.insertStmt = this.db.prepare(
      `INSERT OR IGNORE INTO results (${cols}) VALUES (${placeholders})`,
    )
    // On a re-sighting, fill blanks without clobbering data we already have — a later
    // tile may carry an email or rating the first pass missed, or may carry nothing.
    const merges = COLUMNS.filter((c) => c !== 'placeId').map((c) =>
      NUMERIC.has(c)
        ? `${c} = COALESCE(?, ${c})`
        : `${c} = CASE WHEN ? <> '' THEN ? ELSE ${c} END`,
    )
    this.mergeStmt = this.db.prepare(
      `UPDATE results SET ${merges.join(', ')} WHERE placeId = ?`,
    )
    this.hasStmt = this.db.prepare('SELECT 1 FROM results WHERE placeId = ?')
  }

  /**
   * Store a row, merging into the existing one if this place was already seen.
   * Returns true when the row was new — the caller uses this to count real finds.
   */
  insert(b: Business): boolean {
    const values = COLUMNS.map((c) => {
      const v = b[c] as string | number | null
      return c === 'placeId' ? (v ? v : null) : v
    })
    const res = this.insertStmt.run(...values)
    if (res.changes > 0) return true

    // Conflict: this place id already exists, so merge into it.
    const params: (string | number | null)[] = []
    for (const c of COLUMNS) {
      if (c === 'placeId') continue
      const v = b[c] as string | number | null
      if (NUMERIC.has(c)) params.push(v ?? null)
      else { params.push((v ?? '') as string); params.push((v ?? '') as string) }
    }
    params.push(b.placeId)
    this.mergeStmt.run(...params)
    return false
  }

  /**
   * Whether a place is already stored — asked by the scraper *before* opening a
   * detail page, so overlapping grid tiles skip known places instead of paying a
   * full navigation + enrichment to rediscover them. Blank ids are never "known":
   * unidentifiable rows must always be visited.
   */
  hasPlaceId(placeId: string): boolean {
    if (!placeId) return false
    return this.hasStmt.get(placeId) !== undefined
  }

  /** Release the file handle. Windows keeps the db locked until this runs. */
  close(): void {
    this.db.close()
  }

  /** Remove all rows (called at the start of a new job). */
  reset(): void {
    this.db.exec('DELETE FROM results')
  }

  private whereClause(q: ResultQuery): { sql: string; param: (string | number)[] } {
    const clauses: string[] = []
    const param: (string | number)[] = []
    if (q.q?.trim()) {
      const like = `%${q.q.trim()}%`
      clauses.push('(name LIKE ? OR address LIKE ? OR category LIKE ? OR phone LIKE ? OR email LIKE ?)')
      param.push(like, like, like, like, like)
    }
    if (q.category?.trim()) { clauses.push('category LIKE ?'); param.push(`%${q.category.trim()}%`) }
    if (q.minRating != null) { clauses.push('rating >= ?'); param.push(q.minRating) }
    if (q.minReviews != null) { clauses.push('reviewCount >= ?'); param.push(q.minReviews) }
    if (q.hasEmail) clauses.push("email <> ''")
    if (q.hasWebsite) clauses.push("website <> ''")
    if (q.hasPhone) clauses.push("phone <> ''")
    if (q.lineType?.trim()) {
      // 'unknown' also matches blank/NULL so rows that predate the feature (or
      // haven't been backfilled) stay reachable through the filter.
      if (q.lineType === 'unknown') {
        clauses.push("(lineType = 'unknown' OR lineType = '' OR lineType IS NULL)")
      } else {
        clauses.push('lineType = ?')
        param.push(q.lineType.trim())
      }
    }
    return { sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', param }
  }

  private orderClause(q: ResultQuery): string {
    if (q.sortBy && SORTABLE.has(q.sortBy)) {
      const dir = q.sortDir === 'desc' ? 'DESC' : 'ASC'
      return ` ORDER BY ${q.sortBy} ${dir}`
    }
    return ' ORDER BY id ASC'
  }

  count(q: ResultQuery = {}): number {
    const { sql, param } = this.whereClause(q)
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM results${sql}`).get(...param) as { n: number }
    return row.n
  }

  queryPage(offset: number, limit: number, q: ResultQuery = {}): Business[] {
    const { sql, param } = this.whereClause(q)
    const rows = this.db
      .prepare(`SELECT * FROM results${sql}${this.orderClause(q)} LIMIT ? OFFSET ?`)
      .all(...param, limit, offset)
    return rows.map(toBusiness)
  }

  /** placeIds only, in the same order as queryPage — used for shift-range selection. */
  queryIds(offset: number, limit: number, q: ResultQuery = {}): string[] {
    const { sql, param } = this.whereClause(q)
    const rows = this.db
      .prepare(`SELECT placeId FROM results${sql}${this.orderClause(q)} LIMIT ? OFFSET ?`)
      .all(...param, limit, offset) as { placeId: string }[]
    return rows.map((r) => r.placeId)
  }

  /**
   * Stream rows in id order for CSV export, in batches to bound memory.
   * Accepts the same filter as the paginated reads so an export matches what
   * the user sees in the table.
   */
  *iterateAll(batch = 1000, q: ResultQuery = {}): Generator<Business[]> {
    const { sql, param } = this.whereClause(q)
    let offset = 0
    for (;;) {
      const rows = this.db
        .prepare(`SELECT * FROM results${sql} ORDER BY id ASC LIMIT ? OFFSET ?`)
        .all(...param, batch, offset) as Record<string, unknown>[]
      if (!rows.length) break
      yield rows.map(toBusiness)
      offset += rows.length
      if (rows.length < batch) break
    }
  }
}

function toBusiness(r: any): Business {
  return {
    placeId: r.placeId ?? '',
    name: r.name ?? '', address: r.address ?? '', phone: r.phone ?? '', website: r.website ?? '',
    rating: r.rating ?? null, reviewCount: r.reviewCount ?? null, priceLevel: r.priceLevel ?? '',
    category: r.category ?? '', hours: r.hours ?? '', email: r.email ?? '', mapsUrl: r.mapsUrl ?? '',
    keyword: r.keyword ?? '', location: r.location ?? '',
    facebook: r.facebook ?? '', instagram: r.instagram ?? '', twitter: r.twitter ?? '',
    linkedin: r.linkedin ?? '', youtube: r.youtube ?? '', tiktok: r.tiktok ?? '',
    yelp: r.yelp ?? '', yellowpages: r.yellowpages ?? '',
    ownerName: r.ownerName ?? '', ownerTitle: r.ownerTitle ?? '', ownerSource: r.ownerSource ?? '',
    lineType: r.lineType ?? '', lineCarrier: r.lineCarrier ?? '',
  }
}
