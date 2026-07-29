/**
 * One-off: classify existing results.db rows that predate line-type detection.
 *
 *   npm run linetype:backfill            # default ./results.db
 *   npm run linetype:backfill -- path/to/other.db
 *
 * Idempotent — only rows with blank/NULL lineType are touched, so a re-run
 * selects nothing. Batched short transactions keep a running dev server happy.
 */
import { createRequire } from 'node:module'
import { classifyPhone } from '../src/phone/lineType.js'
import type { LineInfo } from '../src/phone/lineType.js'

const require = createRequire(import.meta.url)
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite')

type Db = InstanceType<typeof DatabaseSync>

const BATCH = 1000

export interface BackfillResult {
  classified: number
  histogram: Record<string, number>
}

/** Exported for tests; the CLI below just opens the file and calls this. */
export function backfillDb(
  db: Db,
  classify: (phone: string) => LineInfo = classifyPhone,
): BackfillResult {
  // A db that has never been opened by the new ResultsStore hasn't run the
  // startup migration yet — add the columns here so the script stands alone.
  const existing = new Set(
    (db.prepare('PRAGMA table_info(results)').all() as { name: string }[]).map((c) => c.name),
  )
  for (const col of ['lineType', 'lineCarrier']) {
    if (!existing.has(col)) db.exec(`ALTER TABLE results ADD COLUMN ${col} TEXT`)
  }

  const select = db.prepare(
    "SELECT id, phone FROM results WHERE lineType IS NULL OR lineType = '' LIMIT ?",
  )
  const update = db.prepare('UPDATE results SET lineType = ?, lineCarrier = ? WHERE id = ?')

  const histogram: Record<string, number> = {}
  let classified = 0
  for (;;) {
    const rows = select.all(BATCH) as { id: number; phone: string | null }[]
    if (rows.length === 0) break
    db.exec('BEGIN')
    try {
      for (const row of rows) {
        const info = classify(row.phone ?? '')
        update.run(info.lineType, info.lineCarrier, row.id)
        histogram[info.lineType] = (histogram[info.lineType] ?? 0) + 1
        classified++
      }
      db.exec('COMMIT')
    } catch (err) {
      db.exec('ROLLBACK')
      throw err
    }
  }
  return { classified, histogram }
}

function formatHistogram(r: BackfillResult): string {
  const order = ['mobile', 'landline', 'voip', 'unknown']
  const parts = order
    .filter((t) => r.histogram[t])
    .map((t) => `${r.histogram[t].toLocaleString()} ${t}`)
  return `classified ${r.classified.toLocaleString()} rows` +
    (parts.length ? `: ${parts.join(' · ')}` : '')
}

const isCli = process.argv[1]?.replace(/\\/g, '/').endsWith('backfill-linetype.ts')
if (isCli) {
  const path = process.argv[2] ?? 'results.db'
  const db = new DatabaseSync(path)
  try {
    const result = backfillDb(db)
    console.log(formatHistogram(result))
  } finally {
    db.close()
  }
}
