import { describe, it, expect } from 'vitest'
import { EnrichPool } from '../src/scraper/enrichPool.js'

/** A task whose completion the test controls. */
function controlled() {
  let resolve!: () => void
  const promise = new Promise<void>((r) => { resolve = r })
  return { promise, resolve }
}

describe('EnrichPool', () => {
  it('never runs more tasks than its concurrency at once', async () => {
    const pool = new EnrichPool(3)
    let running = 0
    let peak = 0
    const gates = Array.from({ length: 8 }, controlled)
    gates.forEach((g) => pool.push(async () => {
      running++; peak = Math.max(peak, running)
      await g.promise
      running--
    }))
    await Promise.resolve()
    expect(running).toBe(3)
    gates.forEach((g) => g.resolve())
    await pool.drain()
    expect(peak).toBe(3)
  })

  it('drain resolves only after every queued task finished', async () => {
    const pool = new EnrichPool(2)
    const done: number[] = []
    for (let i = 0; i < 5; i++) {
      pool.push(async () => { await Promise.resolve(); done.push(i) })
    }
    await pool.drain()
    expect(done).toHaveLength(5)
  })

  it('drain on an idle pool resolves immediately', async () => {
    await new EnrichPool().drain()
  })

  it('abort drops queued tasks; in-flight ones still complete', async () => {
    const pool = new EnrichPool(1)
    const gate = controlled()
    let first = false
    let second = false
    pool.push(async () => { await gate.promise; first = true })
    pool.push(async () => { second = true })
    pool.abort()
    gate.resolve()
    await pool.drain()
    expect(first).toBe(true)
    expect(second).toBe(false)
  })

  it('push after abort is a no-op', async () => {
    const pool = new EnrichPool()
    pool.abort()
    let ran = false
    pool.push(async () => { ran = true })
    await pool.drain()
    expect(ran).toBe(false)
  })

  it('a failing task neither breaks the pool nor blocks drain', async () => {
    const pool = new EnrichPool(1)
    let ran = false
    pool.push(() => { throw new Error('sync boom') })
    pool.push(async () => { throw new Error('async boom') })
    pool.push(async () => { ran = true })
    await pool.drain()
    expect(ran).toBe(true)
  })
})
