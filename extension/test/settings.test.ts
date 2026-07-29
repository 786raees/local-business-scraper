import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, SETTINGS_BOUNDS, clampSettings } from '../src/shared/storage'
import { findCursorByName } from '../src/background/leads'
import type { Lead } from '../src/shared/types'

describe('clampSettings', () => {
  it('leaves in-bounds values alone', () => {
    expect(clampSettings(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS)
  })

  it('clamps the delay to [1s, 30s]', () => {
    expect(clampSettings({ ...DEFAULT_SETTINGS, interCallDelayMs: 0 }).interCallDelayMs)
      .toBe(SETTINGS_BOUNDS.interCallDelayMs.min)
    expect(clampSettings({ ...DEFAULT_SETTINGS, interCallDelayMs: 999999 }).interCallDelayMs)
      .toBe(SETTINGS_BOUNDS.interCallDelayMs.max)
  })

  it('clamps the ringing timeout to [30s, 120s] — the chrome.alarms floor', () => {
    expect(clampSettings({ ...DEFAULT_SETTINGS, ringingTimeoutMs: 5000 }).ringingTimeoutMs)
      .toBe(30000)
    expect(clampSettings({ ...DEFAULT_SETTINGS, ringingTimeoutMs: 300000 }).ringingTimeoutMs)
      .toBe(120000)
  })
})

describe('findCursorByName (Reload leads recovery)', () => {
  const dialable: Lead[] = [
    { rowIndex: 2, name: 'Acme Plumbing', phone: '+1' },
    { rowIndex: 9, name: 'Big Sky Dental', phone: '+2' },
    { rowIndex: 14, name: 'Hilltop Vet', phone: '+3' },
  ]

  it('re-finds the business by name after a re-sort changed its row', () => {
    expect(findCursorByName(dialable, 'Big Sky Dental')).toBe(1)
    expect(findCursorByName(dialable, '  big  sky dental ')).toBe(1)
  })

  it('returns null when the business is gone or the name is empty', () => {
    expect(findCursorByName(dialable, 'Deleted Biz')).toBeNull()
    expect(findCursorByName(dialable, '')).toBeNull()
  })
})
