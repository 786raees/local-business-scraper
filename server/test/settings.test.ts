import { describe, it, expect } from 'vitest'
import { normalizeSettings } from '../src/types.js'

describe('normalizeSettings', () => {
  it('fills defaults for a bare request body', () => {
    const s = normalizeSettings({})
    expect(s.maxResults).toBeGreaterThan(0)
    expect(s.tileKm).toBeGreaterThan(0)
    expect(s.maxTiles).toBeGreaterThan(0)
    expect(s.segment).toBe(false)
  })

  // segment:true with no tileKm would otherwise reach tileGrid as undefined and throw,
  // aborting the whole job instead of scraping.
  it('supplies a usable tileKm when segmentation is on but unspecified', () => {
    const s = normalizeSettings({ segment: true })
    expect(s.tileKm).toBeGreaterThan(0)
    expect(Number.isFinite(s.tileKm)).toBe(true)
  })

  it('clamps a nonsensical tileKm instead of accepting it', () => {
    expect(normalizeSettings({ segment: true, tileKm: 0 }).tileKm).toBeGreaterThan(0)
    expect(normalizeSettings({ segment: true, tileKm: -5 }).tileKm).toBeGreaterThan(0)
    expect(normalizeSettings({ segment: true, tileKm: 99999 }).tileKm).toBeLessThanOrEqual(100)
  })

  it('clamps maxTiles to keep one job from queueing forever', () => {
    expect(normalizeSettings({ maxTiles: 10_000_000 }).maxTiles).toBeLessThanOrEqual(5000)
    expect(normalizeSettings({ maxTiles: 0 }).maxTiles).toBeGreaterThan(0)
  })

  it('keeps a valid delay range and repairs an inverted one', () => {
    expect(normalizeSettings({ delayMinMs: 100, delayMaxMs: 900 })).toMatchObject({
      delayMinMs: 100, delayMaxMs: 900,
    })
    const flipped = normalizeSettings({ delayMinMs: 900, delayMaxMs: 100 })
    expect(flipped.delayMinMs).toBeLessThanOrEqual(flipped.delayMaxMs)
  })

  it('coerces string numbers arriving over JSON', () => {
    const s = normalizeSettings({ maxResults: '40', tileKm: '3' } as any)
    expect(s.maxResults).toBe(40)
    expect(s.tileKm).toBe(3)
  })

  it('preserves explicit booleans', () => {
    expect(normalizeSettings({ segment: true, headless: false, extractEmail: true }))
      .toMatchObject({ segment: true, headless: false, extractEmail: true })
  })
})
