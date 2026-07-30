/**
 * Bounded-concurrency queue for website enrichment (story 06).
 *
 * Enrichment used to run inline in the Maps loop, so every business website —
 * up to nine page loads at a 12s timeout each — blocked the next detail visit.
 * The pool decouples them: the Maps loop keeps harvesting while at most
 * `concurrency` enrichment tasks run against third-party sites. Navigation on
 * google.com stays strictly serial — the concurrency here applies only to the
 * businesses' own websites, which preserves the polite-scraper stance.
 */
export class EnrichPool {
  private queue: (() => Promise<void>)[] = []
  private active = 0
  private waiters: (() => void)[] = []
  private aborted = false

  constructor(private concurrency = 3) {}

  /** Queue a task. Errors are the task's own problem — the pool never rejects. */
  push(task: () => Promise<void>): void {
    if (this.aborted) return
    this.queue.push(task)
    this.pump()
  }

  /**
   * Drop everything not yet started. In-flight tasks are left to finish (or die
   * with the browser their pages belong to); `drain` still resolves once they do.
   */
  abort(): void {
    this.aborted = true
    this.queue = []
    if (!this.active) this.release()
  }

  /** Resolves when the queue is empty and every worker is idle. */
  drain(): Promise<void> {
    if (!this.active && !this.queue.length) return Promise.resolve()
    return new Promise((resolve) => this.waiters.push(resolve))
  }

  private pump(): void {
    while (this.active < this.concurrency && this.queue.length) {
      const task = this.queue.shift()!
      this.active++
      // Promise.resolve().then(...) so a synchronously-throwing task cannot
      // escape the catch and leave `active` stuck above zero.
      void Promise.resolve().then(task).catch(() => {}).finally(() => {
        this.active--
        this.pump()
        if (!this.active && !this.queue.length) this.release()
      })
    }
  }

  private release(): void {
    const waiters = this.waiters
    this.waiters = []
    for (const w of waiters) w()
  }
}
