import { describe, expect, it } from 'vitest'
import {
  recordingBasename,
  recordingFileName,
  shouldAutoDiscard,
  slugify,
} from '../src/background/recorder'
import { withRecordingNote } from '../src/background/outcomes'
import {
  buildSnapshot,
  consumeRecordingForOutcome,
  restoreRecordingOnUndo,
} from '../src/background/state'
import type { RecordingRef, WorkerState } from '../src/background/state'
import { buildMapping } from '../src/sheets/mapping'
import { clampSettings, DEFAULT_SETTINGS } from '../src/shared/storage'

describe('slugify (story 15 decision 5)', () => {
  it('strips path-hostile characters and collapses whitespace to dashes', () => {
    expect(slugify('Big Sky Dental')).toBe('Big-Sky-Dental')
    expect(slugify('  A/B\\C:D*E?F"G<H>I|J  ')).toBe('ABCDEFGHIJ')
    expect(slugify("Bob's Plumbing & Heating #1")).toBe('Bobs-Plumbing-Heating-1')
  })

  it('never yields an empty or over-long segment', () => {
    expect(slugify('///')).toBe('untitled')
    expect(slugify('')).toBe('untitled')
    expect(slugify('x'.repeat(200))).toHaveLength(60)
  })
})

describe('recordingFileName', () => {
  it('is deterministic: folder per tab, row + name + minute timestamp', () => {
    const name = recordingFileName(
      'Miami', { rowIndex: 42, name: 'Big Sky Dental' }, '2026-07-30T14:05:33.123Z')
    expect(name).toBe('gv-quick-dial/Miami/row-42_Big-Sky-Dental_2026-07-30T14-05.webm')
  })

  it('slugs both the tab title and the business name', () => {
    const name = recordingFileName(
      'Leads: East/West', { rowIndex: 7, name: 'A "B" C' }, '2026-07-30T09:00:00Z')
    expect(name).toBe('gv-quick-dial/Leads-EastWest/row-7_A-B-C_2026-07-30T09-00.webm')
  })

  it('basename is the path minus the folders — what the Notes cell gets', () => {
    const path = recordingFileName('Miami', { rowIndex: 2, name: 'X' }, '2026-07-30T09:00:00Z')
    expect(recordingBasename(path)).toBe('row-2_X_2026-07-30T09-00.webm')
    expect(path.endsWith(recordingBasename(path))).toBe(true)
  })
})

describe('withRecordingNote (story 15 decision 6)', () => {
  it('appends the tag to an existing note, on its own line', () => {
    expect(withRecordingNote('spoke to owner', 'row-2_X.webm'))
      .toBe('spoke to owner\n🎙 row-2_X.webm')
  })

  it('is the whole note when the user typed nothing', () => {
    expect(withRecordingNote(undefined, 'row-2_X.webm')).toBe('🎙 row-2_X.webm')
    expect(withRecordingNote('  ', 'row-2_X.webm')).toBe('🎙 row-2_X.webm')
  })

  it('no recording → note untouched, absent stays absent (no empty write)', () => {
    expect(withRecordingNote('a note', undefined)).toBe('a note')
    expect(withRecordingNote(undefined, undefined)).toBeUndefined()
  })
})

describe('consent gate (story 15 decision 2)', () => {
  it('recordingEnabled cannot persist true without the consent acknowledgement', () => {
    expect(clampSettings({ ...DEFAULT_SETTINGS, recordingEnabled: true }).recordingEnabled)
      .toBe(false)
    expect(clampSettings({
      ...DEFAULT_SETTINGS,
      recordingEnabled: true,
      recordingConsentAt: '2026-07-30T00:00:00Z',
    }).recordingEnabled).toBe(true)
  })

  it('withdrawing consent forces recording off', () => {
    const consented = clampSettings({
      ...DEFAULT_SETTINGS,
      recordingEnabled: true,
      recordingConsentAt: '2026-07-30T00:00:00Z',
    })
    expect(clampSettings({ ...consented, recordingConsentAt: undefined }).recordingEnabled)
      .toBe(false)
  })

  it('default settings ship with recording off', () => {
    expect(DEFAULT_SETTINGS.recordingEnabled).toBe(false)
    expect(DEFAULT_SETTINGS.recordingConsentAt).toBeUndefined()
  })
})

describe('auto-discard gate (story 16 decision 4)', () => {
  it('discards under the threshold, keeps at and above it', () => {
    expect(shouldAutoDiscard(4999, 5)).toBe(true)
    expect(shouldAutoDiscard(5000, 5)).toBe(false)
    expect(shouldAutoDiscard(47_000, 5)).toBe(false)
  })

  it('0 keeps everything, even zero-length recordings', () => {
    expect(shouldAutoDiscard(0, 0)).toBe(false)
    expect(shouldAutoDiscard(100, 0)).toBe(false)
  })
})

describe('recordingMinSeconds clamping (story 16)', () => {
  it('clamps to [0, 60] and defaults to 5', () => {
    expect(DEFAULT_SETTINGS.recordingMinSeconds).toBe(5)
    expect(clampSettings({ ...DEFAULT_SETTINGS, recordingMinSeconds: -3 }).recordingMinSeconds)
      .toBe(0)
    expect(clampSettings({ ...DEFAULT_SETTINGS, recordingMinSeconds: 999 }).recordingMinSeconds)
      .toBe(60)
    expect(clampSettings({ ...DEFAULT_SETTINGS, recordingMinSeconds: NaN }).recordingMinSeconds)
      .toBe(5)
  })
})

describe('recording ref lifecycle (story 16 decision 1)', () => {
  const ref: RecordingRef = { file: 'row-2_X.webm', downloadId: 7, durationMs: 47_000 }

  it('outcome consumes the ref into the note and stashes it for undo', () => {
    const state = { lastRecording: ref, pendingRecording: undefined }
    const file = consumeRecordingForOutcome(state)
    expect(file).toBe('row-2_X.webm')
    expect(withRecordingNote(undefined, file)).toBe('🎙 row-2_X.webm')
    expect(state.lastRecording).toBeUndefined()
    expect(state.pendingRecording).toBe(ref)
  })

  it('undo → re-log re-attaches the same 🎙 line (the decision-1 fix)', () => {
    const state = { lastRecording: ref, pendingRecording: undefined as RecordingRef | undefined }
    consumeRecordingForOutcome(state) // first log
    restoreRecordingOnUndo(state) // undo reopens S5
    expect(state.lastRecording).toBe(ref)
    expect(state.pendingRecording).toBeUndefined()
    const file = consumeRecordingForOutcome(state) // re-log
    expect(withRecordingNote('changed my mind', file))
      .toBe('changed my mind\n🎙 row-2_X.webm')
  })

  it('discard drops the ref, so the outcome note carries no 🎙 line', () => {
    const state = { lastRecording: ref as RecordingRef | undefined, pendingRecording: undefined }
    state.lastRecording = undefined // what recording/discard does (deletion aside)
    const file = consumeRecordingForOutcome(state)
    expect(file).toBeUndefined()
    expect(withRecordingNote('junk call', file)).toBe('junk call')
  })

  it('no recording at all behaves identically to discard', () => {
    const state = { lastRecording: undefined, pendingRecording: undefined }
    expect(consumeRecordingForOutcome(state)).toBeUndefined()
    restoreRecordingOnUndo(state)
    expect(state.lastRecording).toBeUndefined()
  })
})

describe('snapshot wire shape (story 16 decision 2)', () => {
  it('exposes file + durationMs and never the downloadId', () => {
    const state: WorkerState = {
      selection: { spreadsheetId: 's', spreadsheetName: 'S', tabTitle: 'T' },
      mapping: buildMapping(['name', 'phone', 'Call Status']),
      leads: [{ rowIndex: 2, name: 'A', phone: '+1' }],
      skippedNoPhone: 0,
      cursor: 0,
      phase: 'awaiting-outcome',
      callState: 'ended',
      autoRun: 0,
      pendingStop: false,
      preselectedNoAnswer: false,
      atEnd: false,
      lastRecording: { file: 'row-2_A.webm', downloadId: 42, durationMs: 61_000 },
    }
    const snap = buildSnapshot(state, { status: 'all' })
    expect(snap.lastRecording).toEqual({ file: 'row-2_A.webm', durationMs: 61_000 })
    expect(JSON.stringify(snap)).not.toContain('downloadId')
  })
})
