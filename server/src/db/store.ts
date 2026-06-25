import { createRequire } from 'node:module'
import { Business } from '../types.js'

// node:sqlite is a runtime builtin; load via require so bundlers (vitest/vite)
// don't try to statically resolve it.
const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')

const COLUMNS: (keyof Business)[] = [
  'name', 'address', 'phone', 'website', 'rating', 'reviewCount', 'priceLevel',
  'category', 'hours', 'email', 'mapsUrl', 'keyword', 'location',
]

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
        keyword TEXT, location TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_results_name ON results(name);
    `)
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

  private whereClause(filter: string): { sql: string; param: string[] } {
    if (!filter.trim()) return { sql: '', param: [] }
    const like = `%${filter.trim()}%`
    return {
      sql: ' WHERE name LIKE ? OR address LIKE ? OR category LIKE ? OR phone LIKE ? OR email LIKE ?',
      param: [like, like, like, like, like],
    }
  }

  count(filter = ''): number {
    const { sql, param } = this.whereClause(filter)
    const row = this.db.prepare(`SELECT COUNT(*) AS n FROM results${sql}`).get(...param) as { n: number }
    return row.n
  }

  queryPage(offset: number, limit: number, filter = ''): Business[] {
    const { sql, param } = this.whereClause(filter)
    const rows = this.db
      .prepare(`SELECT * FROM results${sql} ORDER BY id ASC LIMIT ? OFFSET ?`)
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
  }
}
