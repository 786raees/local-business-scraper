import { describe, expect, it, vi } from 'vitest'
import { WriteQueue } from '../src/background/writeQueue'
import type { QueueEntry, QueueState, QueueStore, WriteResult } from '../src/background/writeQueue'

function fakeStore(): QueueStore & { snapshots: QueueState[] } {
  let state: QueueState | null = null
  const snapshots: QueueState[] = []
  return {
    snapshots,
    async load() { return state ? JSON.parse(JSON.stringify(state)) as QueueState : null },
    async save(s) {
      state = JSON.parse(JSON.stringify(s)) as QueueState
      snapshots.push(state)
    },
  }
}

const ENTRY = {
  rowIndex: 42,
  leadName: 'Big Sky Dental',
  outcome: 'Answered' as const,
  spreadsheetId: 'sid',
  tabTitle: 'Leads',
  cells: { nameCell: 'A42', callStatusCell: 'C42', notesCell: 'J42' },
  notBefore: 0,
}

function makeQueue(opts: {
  results?: WriteResult[]
  now?: () => number
  store?: QueueStore
}) {
  const written: QueueEntry[] = []
  const stale: QueueEntry[] = []
  const results = opts.results ?? ['ok']
  let call = 0
  const writerCalls: number[] = []
  const store = opts.store ?? fakeStore()
  const queue = new WriteQueue(
    store,
    async (e) => {
      writerCalls.push(e.rowIndex)
      return results[Math.min(call++, results.length - 1)]
    },
    {
      async onWritten(e) { written.push(e) },
      async onStale(e) { stale.push(e) },
      onChanged() {},
    },
    opts.now ?? (() => 1_000_000),
  )
  return { queue, written, stale, writerCalls, store }
}

describe('enqueue-before-network', () => {
  it('persists the intent before the writer runs', async () => {
    const store = fakeStore()
    const order: string[] = []
    const trackingStore: QueueStore = {
      load: () => store.load(),
      save: async (s: QueueState) => { order.push('save'); await store.save(s) },
    }
    const queue = new WriteQueue(
      trackingStore,
      async () => { order.push('write'); return 'ok' },
      { async onWritten() {}, async onStale() {}, onChanged() {} },
    )
    await queue.init()
    await queue.enqueue(ENTRY)
    await queue.drain()
    expect(order[0]).toBe('save')
    expect(order).toContain('write')
  })
})

describe('drain', () => {
  it('writes due entries and removes them', async () => {
    const { queue, written, writerCalls } = makeQueue({ results: ['ok'] })
    await queue.init()
    await queue.enqueue(ENTRY)
    await queue.drain()
    expect(written).toHaveLength(1)
    expect(writerCalls).toEqual([42])
    expect(queue.list()).toHaveLength(0)
  })

  it('skips entries still inside their undo window', async () => {
    const { queue, writerCalls } = makeQueue({ now: () => 1000 })
    await queue.init()
    await queue.enqueue({ ...ENTRY, notBefore: 5000 }) // due later
    await queue.drain()
    expect(writerCalls).toHaveLength(0)
    expect(queue.dueCount()).toBe(0)
    expect(queue.list()).toHaveLength(1)
  })

  it('keeps the entry on transient failure and retries on the next drain', async () => {
    const { queue, written } = makeQueue({ results: ['transient', 'ok'] })
    await queue.init()
    await queue.enqueue(ENTRY)
    await queue.drain()
    expect(queue.list()).toHaveLength(1) // kept
    await queue.drain() // the 1-minute alarm path
    expect(written).toHaveLength(1)
    expect(queue.list()).toHaveLength(0)
  })

  it('pauses on denied (403) and drains nothing further until retry', async () => {
    const { queue, writerCalls } = makeQueue({ results: ['denied', 'ok', 'ok'] })
    await queue.init()
    await queue.enqueue(ENTRY)
    await queue.enqueue({ ...ENTRY, rowIndex: 43, cells: { ...ENTRY.cells, nameCell: 'A43', callStatusCell: 'C43' } })
    await queue.drain()
    expect(queue.isPaused()).toBe(true)
    expect(writerCalls).toEqual([42]) // second entry never attempted
    await queue.drain()
    expect(writerCalls).toEqual([42]) // still paused

    await queue.retry() // user fixed sharing
    expect(queue.isPaused()).toBe(false)
    expect(queue.list()).toHaveLength(0)
  })

  it('drops a stale entry and surfaces it rather than writing the wrong row', async () => {
    const { queue, stale, written } = makeQueue({ results: ['stale'] })
    await queue.init()
    await queue.enqueue(ENTRY)
    await queue.drain()
    expect(stale).toHaveLength(1)
    expect(written).toHaveLength(0)
    expect(queue.list()).toHaveLength(0)
  })
})

describe('undo & makeDue', () => {
  it('remove() before due means the writer never sees the entry', async () => {
    const { queue, writerCalls } = makeQueue({ now: () => 1000 })
    await queue.init()
    const id = await queue.enqueue({ ...ENTRY, notBefore: 5000 })
    await queue.remove(id)
    await queue.drain()
    expect(writerCalls).toHaveLength(0)
    expect(queue.list()).toHaveLength(0)
  })

  it('makeDue() closes the undo window early', async () => {
    const { queue, written } = makeQueue({ now: () => 1000 })
    await queue.init()
    const id = await queue.enqueue({ ...ENTRY, notBefore: 5000 })
    await queue.makeDue(id)
    await vi.waitFor(() => expect(written).toHaveLength(1))
  })
})

describe('worker-restart recovery', () => {
  it('a new queue instance over the same store drains what the dead worker left', async () => {
    const store = fakeStore()
    const first = makeQueue({ results: ['transient'], store })
    await first.queue.init()
    await first.queue.enqueue(ENTRY)
    await first.queue.drain() // fails transiently, entry persisted

    const second = makeQueue({ results: ['ok'], store })
    await second.queue.init()
    await second.queue.drain()
    expect(second.written).toHaveLength(1)
    expect(second.queue.list()).toHaveLength(0)
  })
})
