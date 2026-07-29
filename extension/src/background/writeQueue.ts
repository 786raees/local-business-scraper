import type { PendingWrite } from './outcomes'

/**
 * Durable outcome write queue (ARCHITECTURE §7.3). The intent is persisted to
 * chrome.storage.local BEFORE any network call, so outcomes survive worker
 * death, offline periods, and rate limits — and a slow Sheets API never
 * blocks the next call.
 *
 * The undo window is structural: each entry carries `notBefore` (the
 * between-calls countdown end); the drain skips entries that aren't due, and
 * undo simply removes the entry — nothing to race, nothing to roll back.
 */

export interface QueueEntry extends PendingWrite {
  id: string
  spreadsheetId: string
  tabTitle: string
  /** A1 cells resolved from the header mapping at enqueue time, so a queued
   * entry stays writable even after a different tab is loaded. */
  cells: { nameCell: string; callStatusCell: string; notesCell: string | null }
  /** Enqueued at (epoch ms) — drives the "age" column in the popover. */
  ts: number
  /** Not written before this time — the undo window. */
  notBefore: number
  attempts: number
}

export interface QueueState {
  entries: QueueEntry[]
  /** 403: retrying is pointless until sharing is fixed (ARCH §7.3). */
  paused: boolean
}

export interface QueueStore {
  load(): Promise<QueueState | null>
  save(state: QueueState): Promise<void>
}

/**
 * Executes one entry against the sheet.
 * 'ok' → written; 'stale' → row guard failed (unrecoverable, surfaced);
 * 'denied' → 403 (pause queue); 'transient' → keep and retry later.
 */
export type WriteResult = 'ok' | 'stale' | 'denied' | 'transient'

export interface QueueCallbacks {
  onWritten(entry: QueueEntry): Promise<void>
  onStale(entry: QueueEntry): Promise<void>
  /** Fired whenever counts/paused change, so the snapshot can rebroadcast. */
  onChanged(): void
}

export class WriteQueue {
  private state: QueueState = { entries: [], paused: false }
  private draining = false

  constructor(
    private store: QueueStore,
    private writer: (entry: QueueEntry) => Promise<WriteResult>,
    private callbacks: QueueCallbacks,
    private now: () => number = () => Date.now(),
  ) {}

  async init(): Promise<void> {
    this.state = (await this.store.load()) ?? { entries: [], paused: false }
  }

  /** Entries past their undo window and not yet written. */
  dueCount(): number {
    return this.state.entries.filter((e) => e.notBefore <= this.now()).length
  }

  isPaused(): boolean {
    return this.state.paused
  }

  list(): QueueEntry[] {
    return [...this.state.entries]
  }

  /** Persist FIRST, then drain — the write intent must outlive this worker. */
  async enqueue(entry: Omit<QueueEntry, 'id' | 'ts' | 'attempts'>): Promise<string> {
    const id = `${entry.rowIndex}-${this.now()}`
    this.state.entries.push({ ...entry, id, ts: this.now(), attempts: 0 })
    await this.store.save(this.state)
    this.callbacks.onChanged()
    void this.drain()
    return id
  }

  /** Undo: the entry hasn't been written (still inside notBefore) — drop it. */
  async remove(id: string): Promise<void> {
    this.state.entries = this.state.entries.filter((e) => e.id !== id)
    await this.store.save(this.state)
    this.callbacks.onChanged()
  }

  /** Close the undo window early (dial-now / pause / end of list). */
  async makeDue(id: string): Promise<void> {
    const entry = this.state.entries.find((e) => e.id === id)
    if (entry) {
      entry.notBefore = this.now()
      await this.store.save(this.state)
    }
    void this.drain()
  }

  /** Manual retry — also unpauses after the user fixes sharing. */
  async retry(): Promise<void> {
    this.state.paused = false
    await this.store.save(this.state)
    this.callbacks.onChanged()
    await this.drain()
  }

  async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      for (;;) {
        if (this.state.paused) return
        const entry = this.state.entries.find((e) => e.notBefore <= this.now())
        if (!entry) return
        entry.attempts++
        const result = await this.writer(entry)
        switch (result) {
          case 'ok':
            this.state.entries = this.state.entries.filter((e) => e.id !== entry.id)
            await this.store.save(this.state)
            await this.callbacks.onWritten(entry)
            this.callbacks.onChanged()
            break
          case 'stale':
            // Can never succeed — drop it and surface the error loudly.
            this.state.entries = this.state.entries.filter((e) => e.id !== entry.id)
            await this.store.save(this.state)
            await this.callbacks.onStale(entry)
            this.callbacks.onChanged()
            break
          case 'denied':
            this.state.paused = true
            await this.store.save(this.state)
            this.callbacks.onChanged()
            return
          case 'transient':
            // Keep the entry; the 1-minute alarm retries.
            await this.store.save(this.state)
            this.callbacks.onChanged()
            return
        }
      }
    } finally {
      this.draining = false
    }
  }
}
