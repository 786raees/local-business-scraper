import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createRequire } from 'node:module'
import { describe, it, expect } from 'vitest'
import { ResultsStore } from '../src/db/store.js'
import { emptyBusiness } from '../src/types.js'

function biz(name: string, extra: Partial<ReturnType<typeof emptyBusiness>> = {}) {
  return { ...emptyBusiness('kw', 'loc'), name, ...extra }
}

describe('ResultsStore', () => {
  it('inserts and counts rows', () => {
    const s = new ResultsStore(':memory:')
    s.insert(biz('Acme'))
    s.insert(biz('Beta'))
    expect(s.count()).toBe(2)
  })

  it('paginates in insertion order', () => {
    const s = new ResultsStore(':memory:')
    for (let i = 0; i < 25; i++) s.insert(biz(`Biz ${i}`))
    const page = s.queryPage(10, 5)
    expect(page).toHaveLength(5)
    expect(page[0].name).toBe('Biz 10')
    expect(page[4].name).toBe('Biz 14')
  })

  it('filters by global text across fields', () => {
    const s = new ResultsStore(':memory:')
    s.insert(biz('Joe Plumbing', { category: 'Plumber' }))
    s.insert(biz('City Cafe', { category: 'Coffee shop' }))
    expect(s.count({ q: 'plumb' })).toBe(1)
    expect(s.queryPage(0, 10, { q: 'coffee' })[0].name).toBe('City Cafe')
  })

  it('filters by rating, reviews, and presence flags', () => {
    const s = new ResultsStore(':memory:')
    s.insert(biz('A', { rating: 4.8, reviewCount: 200, email: 'a@x.com', website: 'https://a.com' }))
    s.insert(biz('B', { rating: 3.5, reviewCount: 10, email: '', website: '' }))
    expect(s.count({ minRating: 4 })).toBe(1)
    expect(s.count({ minReviews: 100 })).toBe(1)
    expect(s.count({ hasEmail: true })).toBe(1)
    expect(s.count({ hasWebsite: true })).toBe(1)
    expect(s.queryPage(0, 10, { minRating: 4 })[0].name).toBe('A')
  })

  it('sorts by an allowed column and ignores disallowed ones', () => {
    const s = new ResultsStore(':memory:')
    s.insert(biz('Bravo', { rating: 4.0 }))
    s.insert(biz('Alpha', { rating: 5.0 }))
    expect(s.queryPage(0, 10, { sortBy: 'name', sortDir: 'asc' })[0].name).toBe('Alpha')
    expect(s.queryPage(0, 10, { sortBy: 'rating', sortDir: 'desc' })[0].name).toBe('Alpha')
    // disallowed sort column falls back to id order (insertion order)
    expect(s.queryPage(0, 10, { sortBy: 'id; DROP TABLE results' })[0].name).toBe('Bravo')
  })

  it('reset clears all rows', () => {
    const s = new ResultsStore(':memory:')
    s.insert(biz('X')); s.reset()
    expect(s.count()).toBe(0)
  })

  it('iterateAll streams every row in batches', () => {
    const s = new ResultsStore(':memory:')
    for (let i = 0; i < 2500; i++) s.insert(biz(`B${i}`))
    let total = 0
    for (const batch of s.iterateAll(1000)) total += batch.length
    expect(total).toBe(2500)
  })
})

describe('ResultsStore deduplication', () => {
  // Grid segmentation makes adjacent tiles overlap heavily, so the same place arrives
  // many times. Identity is the Google place id, not the URL or the name.
  it('keeps one row when the same place id is inserted twice', () => {
    const s = new ResultsStore(':memory:')
    s.insert(biz('Acme Dental', { placeId: 'ChIJabc' }))
    s.insert(biz('Acme Dental', { placeId: 'ChIJabc' }))
    expect(s.count()).toBe(1)
  })

  it('treats different place ids as distinct rows', () => {
    const s = new ResultsStore(':memory:')
    s.insert(biz('Acme Dental', { placeId: 'ChIJabc' }))
    s.insert(biz('Acme Dental', { placeId: 'ChIJxyz' }))
    expect(s.count()).toBe(2)
  })

  it('fills blank fields from a later sighting instead of discarding it', () => {
    const s = new ResultsStore(':memory:')
    s.insert(biz('Acme', { placeId: 'ChIJabc', phone: '123' }))
    s.insert(biz('Acme', { placeId: 'ChIJabc', email: 'a@b.com', rating: 4.5 }))
    const [row] = s.queryPage(0, 10)
    expect(s.count()).toBe(1)
    expect(row.phone).toBe('123')        // kept from the first sighting
    expect(row.email).toBe('a@b.com')    // filled in by the second
    expect(row.rating).toBe(4.5)
  })

  it('does not overwrite an existing value with a blank one', () => {
    const s = new ResultsStore(':memory:')
    s.insert(biz('Acme', { placeId: 'ChIJabc', email: 'keep@me.com', rating: 4.1 }))
    s.insert(biz('Acme', { placeId: 'ChIJabc', email: '', rating: null }))
    const [row] = s.queryPage(0, 10)
    expect(row.email).toBe('keep@me.com')
    expect(row.rating).toBe(4.1)
  })

  it('never collapses rows that have no place id', () => {
    const s = new ResultsStore(':memory:')
    s.insert(biz('No Id A'))
    s.insert(biz('No Id B'))
    s.insert(biz('No Id C'))
    expect(s.count()).toBe(3)
  })

  it('reports how many inserts were new vs merged', () => {
    const s = new ResultsStore(':memory:')
    expect(s.insert(biz('Acme', { placeId: 'ChIJabc' }))).toBe(true)
    expect(s.insert(biz('Acme', { placeId: 'ChIJabc' }))).toBe(false)
  })

  // Asked before every detail navigation (story 06): a known place is skipped
  // without opening its page, so this must be exact and blank-safe.
  it('hasPlaceId answers for stored ids only', () => {
    const s = new ResultsStore(':memory:')
    s.insert(biz('Acme', { placeId: 'ChIJabc' }))
    expect(s.hasPlaceId('ChIJabc')).toBe(true)
    expect(s.hasPlaceId('ChIJnope')).toBe(false)
  })

  it('hasPlaceId is never true for a blank id, even with id-less rows stored', () => {
    const s = new ResultsStore(':memory:')
    s.insert(biz('No Id'))
    expect(s.hasPlaceId('')).toBe(false)
  })

  // Mirrors handleEvent in index.ts (story 06): an enrichment update merges via
  // insert but adjusts neither counter — otherwise every enriched row would show
  // up as a "duplicate" in the TopBar and the dedup metric becomes noise.
  it('an enrichment update merges without counting as new or duplicate', () => {
    const s = new ResultsStore(':memory:')
    let inserted = 0
    let duplicates = 0
    const handle = (b: ReturnType<typeof biz>, update?: boolean) => {
      if (update) s.insert(b)
      else if (s.insert(b)) inserted++
      else duplicates++
    }
    handle(biz('Acme', { placeId: 'p1' }))
    handle(biz('Acme', { placeId: 'p1', email: 'late@enrich.com' }), true)
    handle(biz('Acme', { placeId: 'p1' }))   // a genuine overlap re-sighting
    expect(inserted).toBe(1)
    expect(duplicates).toBe(1)
    expect(s.queryPage(0, 1)[0].email).toBe('late@enrich.com')
  })
})

describe('ResultsStore lineType', () => {
  const seeded = () => {
    const s = new ResultsStore(':memory:')
    s.insert(biz('Mob', { placeId: 'p1', phone: '+1 305', lineType: 'mobile', lineCarrier: 'Verizon Wireless' }))
    s.insert(biz('Land', { placeId: 'p2', phone: '+1 202', lineType: 'landline', lineCarrier: 'BellSouth' }))
    s.insert(biz('Voip', { placeId: 'p3', phone: '+1 312', lineType: 'voip', lineCarrier: 'Bandwidth' }))
    s.insert(biz('Unk', { placeId: 'p4', phone: '', lineType: 'unknown' }))
    s.insert(biz('Blank', { placeId: 'p5', phone: '+44 20' })) // pre-backfill row: lineType ''
    return s
  }

  it('round-trips both fields through insert and read', () => {
    const s = seeded()
    const mob = s.queryPage(0, 10, { lineType: 'mobile' })[0]
    expect(mob.lineType).toBe('mobile')
    expect(mob.lineCarrier).toBe('Verizon Wireless')
  })

  it('filters by each type; unknown also catches blank legacy rows', () => {
    const s = seeded()
    expect(s.count({ lineType: 'mobile' })).toBe(1)
    expect(s.count({ lineType: 'landline' })).toBe(1)
    expect(s.count({ lineType: 'voip' })).toBe(1)
    expect(s.count({ lineType: 'unknown' })).toBe(2) // explicit unknown + blank
    expect(s.queryPage(0, 10, { lineType: 'unknown' }).map((r) => r.name).sort())
      .toEqual(['Blank', 'Unk'])
  })

  it('composes with existing filters', () => {
    const s = seeded()
    expect(s.count({ lineType: 'mobile', hasPhone: true })).toBe(1)
    expect(s.count({ lineType: 'unknown', hasPhone: true })).toBe(1) // Blank has a phone
  })

  it('sorts by lineType but rejects lineCarrier (allowlist guard)', () => {
    const s = seeded()
    const sorted = s.queryPage(0, 10, { sortBy: 'lineType', sortDir: 'asc' }).map((r) => r.lineType)
    expect(sorted).toEqual([...sorted].sort())
    // Disallowed column falls back to insertion order rather than injecting SQL.
    const fallback = s.queryPage(0, 10, { sortBy: 'lineCarrier' }).map((r) => r.name)
    expect(fallback[0]).toBe('Mob')
  })

  it('iterateAll honours the filter, so a filtered CSV export matches the view', () => {
    const s = seeded()
    const all = [...s.iterateAll(2)].flat()
    expect(all).toHaveLength(5)
    const mobiles = [...s.iterateAll(2, { lineType: 'mobile' })].flat()
    expect(mobiles.map((r) => r.name)).toEqual(['Mob'])
  })

  it('blank-fills line fields when a duplicate sighting merges', () => {
    const s = new ResultsStore(':memory:')
    s.insert(biz('First', { placeId: 'dup', lineType: 'mobile', lineCarrier: 'T-Mobile' }))
    // Re-sighting with no line data must not clobber what we have.
    expect(s.insert(biz('First', { placeId: 'dup' }))).toBe(false)
    const row = s.queryPage(0, 10)[0]
    expect(row.lineType).toBe('mobile')
    expect(row.lineCarrier).toBe('T-Mobile')
  })
})

describe('ResultsStore migration from a pre-lineType database', () => {
  // Users have an existing results.db written before lineType/lineCarrier existed.
  // Opening it must add both columns without failing or dropping rows.
  it('adds lineType/lineCarrier to a legacy table with rows', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storetest-'))
    const file = join(dir, 'legacy-linetype.db')
    try {
      const require = createRequire(import.meta.url)
      const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
      const legacy = new DatabaseSync(file)
      legacy.exec(`
        CREATE TABLE results (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          placeId TEXT,
          name TEXT, address TEXT, phone TEXT, website TEXT,
          rating REAL, reviewCount INTEGER, priceLevel TEXT,
          category TEXT, hours TEXT, email TEXT, mapsUrl TEXT,
          keyword TEXT, location TEXT,
          facebook TEXT, instagram TEXT, twitter TEXT, linkedin TEXT,
          youtube TEXT, tiktok TEXT, yelp TEXT, yellowpages TEXT,
          ownerName TEXT, ownerTitle TEXT, ownerSource TEXT
        );
        INSERT INTO results (name, placeId) VALUES ('Old A', 'a'), ('Old B', 'b');
      `)
      legacy.close()

      const s = new ResultsStore(file)
      expect(s.count()).toBe(2)                          // legacy rows survive
      expect(s.queryPage(0, 10)[0].lineType).toBe('')    // NULL reads as ''
      expect(s.count({ lineType: 'unknown' })).toBe(2)   // and stays filterable
      expect(s.insert(biz('New', { placeId: 'c', lineType: 'mobile' }))).toBe(true)
      expect(s.count({ lineType: 'mobile' })).toBe(1)
      s.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('backfill-linetype script', () => {
  it('classifies only blank rows, is idempotent, and reports a histogram', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storetest-'))
    const file = join(dir, 'backfill.db')
    try {
      // Seed through the real store: two pre-feature rows (blank lineType via
      // direct SQL, mimicking unmigrated data) + one already-classified row.
      const s = new ResultsStore(file)
      s.insert(biz('Done', { placeId: 'p0', phone: '+1 111', lineType: 'landline', lineCarrier: 'Keep Me' }))
      s.insert(biz('BlankMob', { placeId: 'p1', phone: '+1 305-697-0000' }))
      s.insert(biz('BlankIntl', { placeId: 'p2', phone: '+44 20 7946 0958' }))
      s.insert(biz('NoPhone', { placeId: 'p3', phone: '' }))
      s.close()

      const require2 = createRequire(import.meta.url)
      const { DatabaseSync } = require2('node:sqlite') as typeof import('node:sqlite')
      const { backfillDb } = await import('../scripts/backfill-linetype.js')
      const fakeClassify = (phone: string) =>
        phone.includes('305') ? { lineType: 'mobile' as const, lineCarrier: 'TestCarrier' }
        : { lineType: 'unknown' as const, lineCarrier: '' }

      const db = new DatabaseSync(file)
      const first = backfillDb(db, fakeClassify)
      expect(first.classified).toBe(3)
      expect(first.histogram).toEqual({ mobile: 1, unknown: 2 })

      const second = backfillDb(db, fakeClassify)   // idempotent
      expect(second.classified).toBe(0)
      db.close()

      const check = new ResultsStore(file)
      expect(check.queryPage(0, 10, { lineType: 'landline' })[0].lineCarrier).toBe('Keep Me')
      expect(check.queryPage(0, 10, { lineType: 'mobile' })[0].name).toBe('BlankMob')
      expect(check.count({ lineType: 'unknown' })).toBe(2)
      check.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

describe('ResultsStore migration from a pre-placeId database', () => {
  // Users have an existing results.db written before placeId existed. Opening it must
  // add the column and the unique index without failing or dropping rows.
  it('adds placeId and its unique index to a legacy table with rows', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'storetest-'))
    const file = join(dir, 'legacy.db')
    try {
      const require = createRequire(import.meta.url)
      const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')
      const legacy = new DatabaseSync(file)
      legacy.exec(`
        CREATE TABLE results (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          name TEXT, address TEXT, phone TEXT, website TEXT,
          rating REAL, reviewCount INTEGER, priceLevel TEXT,
          category TEXT, hours TEXT, email TEXT, mapsUrl TEXT,
          keyword TEXT, location TEXT
        );
        INSERT INTO results (name) VALUES ('Old A'), ('Old B'), ('Old C');
      `)
      legacy.close()

      const s = new ResultsStore(file)
      expect(s.count()).toBe(3)                      // legacy rows survive
      expect(s.insert(biz('New', { placeId: 'ChIJnew' }))).toBe(true)
      expect(s.count()).toBe(4)
      // Legacy rows carry NULL placeId; they must not collide with each other.
      expect(s.queryPage(0, 10).filter((r) => r.placeId === '')).toHaveLength(3)
      s.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
