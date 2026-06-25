import { createRequire } from 'node:module'
import { Business, ResultQuery } from '../types.js'

// node:sqlite is a runtime builtin; load via require so bundlers (vitest/vite)
// don't try to statically resolve it.
const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')

const COLUMNS: (keyof Business)[] = [
  'name', 'address', 'phone', 'website', 'rating', 'reviewCount', 'priceLevel',
  'category', 'hours', 'email', 'mapsUrl', 'keyword', 'location',
  'facebook', 'instagram', 'twitter', 'linkedin', 'youtube', 'tiktok', 'yelp', 'yellowpages',
  'ownerName', 'ownerTitle', 'ownerSource',
]

// Columns the client is allowed to sort by (prevents SQL injection via sortBy).
const SORTABLE = new Set<string>([
  'name', 'rating', 'reviewCount', 'category', 'address', 'phone', 'email', 'location', 'ownerName',
])

/**
 * Disk-backed results store. Holds every scraped row so the frontend never
 * needs all of them in memory and CSV export can stream from disk.
 * Pass ':memory:' in tests.
 */
export class ResultsStore {
  private db: DatabaseSync
  private insertStmt: ReturnType<DatabaseSync['prepare']>

  constructor(path = 'results.db') {
    this.db = new DatabaseSync(path)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT, address TEXT, phone TEXT, website TEXT,
        rating REAL, reviewCount INTEGER, priceLevel TEXT,
        category TEXT, hours TEXT, email TEXT, mapsUrl TEXT,
        keyword TEXT, location TEXT,
        facebook TEXT, instagram TEXT, twitter TEXT, linkedin TEXT,
        youtube TEXT, tiktok TEXT, yelp TEXT, yellowpages TEXT,
        ownerName TEXT, ownerTitle TEXT, ownerSource TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_results_name ON results(name);
    `)
    // Migrate older DBs that predate the social/owner columns.
    const existing = new Set(
      (this.db.prepare('PRAGMA table_info(results)').all() as { name: string }[]).map((c) => c.name),
    )
    const added = [
      'facebook', 'instagram', 'twitter', 'linkedin', 'youtube', 'tiktok', 'yelp', 'yellowpages',
      'ownerName', 'ownerTitle', 'ownerSource',
    ]
    for (const col of added) {
      if (!existing.has(col)) this.db.exec(`ALTER TABLE results ADD COLUMN ${col} TEXT`)
    }
    const cols = COLUMNS.join(', ')
    const placeholders = COLUMNS.map(() => '?').join(', ')
    this.insertStmt = this.db.prepare(`INSERT INTO results (${cols}) VALUES (${placeholders})`)
  }

  insert(b: Business): void {
    this.insertStmt.run(...COLUMNS.map((c) => b[c] as string | number | null))
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

  /** Stream every row in id order for CSV export, in batches to bound memory. */
  *iterateAll(batch = 1000): Generator<Business[]> {
    let offset = 0
    for (;;) {
      const rows = this.db
        .prepare('SELECT * FROM results ORDER BY id ASC LIMIT ? OFFSET ?')
        .all(batch, offset) as Record<string, unknown>[]
      if (!rows.length) break
      yield rows.map(toBusiness)
      offset += rows.length
      if (rows.length < batch) break
    }
  }
}

function toBusiness(r: any): Business {
  return {
    name: r.name ?? '', address: r.address ?? '', phone: r.phone ?? '', website: r.website ?? '',
    rating: r.rating ?? null, reviewCount: r.reviewCount ?? null, priceLevel: r.priceLevel ?? '',
    category: r.category ?? '', hours: r.hours ?? '', email: r.email ?? '', mapsUrl: r.mapsUrl ?? '',
    keyword: r.keyword ?? '', location: r.location ?? '',
    facebook: r.facebook ?? '', instagram: r.instagram ?? '', twitter: r.twitter ?? '',
    linkedin: r.linkedin ?? '', youtube: r.youtube ?? '', tiktok: r.tiktok ?? '',
    yelp: r.yelp ?? '', yellowpages: r.yellowpages ?? '',
    ownerName: r.ownerName ?? '', ownerTitle: r.ownerTitle ?? '', ownerSource: r.ownerSource ?? '',
  }
}
