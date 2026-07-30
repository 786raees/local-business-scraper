import type { ServiceAccountKey, CachedToken, TokenStore } from '../sheets/auth'
import { DEFAULT_CRITERIA, sanitizeCriteria } from './criteria'
import type { DialCriteria, DialFilter } from './types'

/**
 * Typed accessors over chrome.storage (ARCHITECTURE §8).
 * The service-account key lives in storage.local ONLY — never storage.sync,
 * which would replicate the private key to every signed-in Chrome.
 */

const KEY_SLOT = 'serviceAccountKey'
const TOKEN_SLOT = 'token'

export const keyStore = {
  async get(): Promise<ServiceAccountKey | null> {
    const items = await chrome.storage.local.get(KEY_SLOT)
    return (items[KEY_SLOT] as ServiceAccountKey | undefined) ?? null
  },
  async set(key: ServiceAccountKey): Promise<void> {
    await chrome.storage.local.set({ [KEY_SLOT]: key })
  },
  async remove(): Promise<void> {
    await chrome.storage.local.remove(KEY_SLOT)
  },
  /** Fires on any change to the stored key (options ↔ panel sync). */
  onChanged(listener: (key: ServiceAccountKey | null) => void): void {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && KEY_SLOT in changes) {
        listener((changes[KEY_SLOT].newValue as ServiceAccountKey | undefined) ?? null)
      }
    })
  },
}

/** Token mirror in storage.session: dies with the browser, survives worker restarts. */
export const sessionTokenStore: TokenStore = {
  async load(): Promise<CachedToken | null> {
    const items = await chrome.storage.session.get(TOKEN_SLOT)
    return (items[TOKEN_SLOT] as CachedToken | undefined) ?? null
  },
  async save(token: CachedToken): Promise<void> {
    await chrome.storage.session.set({ [TOKEN_SLOT]: token })
  },
}

export async function clearSessionToken(): Promise<void> {
  await chrome.storage.session.remove(TOKEN_SLOT)
}

/** The remembered lead-list selection — lets returning users skip S1/S2 (UX §1). */
export interface Selection {
  spreadsheetId: string
  spreadsheetName: string
  tabTitle?: string
}

const SELECTION_SLOT = 'selection'

export const selectionStore = {
  async get(): Promise<Selection | null> {
    const items = await chrome.storage.local.get(SELECTION_SLOT)
    return (items[SELECTION_SLOT] as Selection | undefined) ?? null
  },
  async set(selection: Selection): Promise<void> {
    await chrome.storage.local.set({ [SELECTION_SLOT]: selection })
  },
  async clear(): Promise<void> {
    await chrome.storage.local.remove(SELECTION_SLOT)
  },
}

export type { DialFilter }

export interface Settings {
  interCallDelayMs: number
  ringingTimeoutMs: number
  dialCriteria: DialCriteria
  /** Story 15: off by default, and inert without the consent acknowledgement. */
  recordingEnabled: boolean
  /** ISO timestamp of the user's call-recording-law acknowledgement. */
  recordingConsentAt?: string
  /** Story 16: auto-discard recordings shorter than this. 0 = keep everything. */
  recordingMinSeconds: number
}

/** Defaults per ARCHITECTURE §8; `uncalled` is the safe default (UX S3.5). */
export const DEFAULT_SETTINGS: Settings = {
  interCallDelayMs: 3000,
  ringingTimeoutMs: 60000,
  dialCriteria: DEFAULT_CRITERIA,
  recordingEnabled: false,
  recordingMinSeconds: 5,
}

const SETTINGS_SLOT = 'settings'

/**
 * Sane bounds (story 11). The ringing-timeout floor is 30s because it rides
 * a chrome.alarms one-shot, and alarms cannot fire earlier than 30s.
 */
export const SETTINGS_BOUNDS = {
  interCallDelayMs: { min: 1000, max: 30000 },
  ringingTimeoutMs: { min: 30000, max: 120000 },
  recordingMinSeconds: { min: 0, max: 60 },
} as const

export function clampSettings(settings: Settings): Settings {
  const clamp = (v: number, b: { min: number; max: number }) =>
    Math.min(b.max, Math.max(b.min, Math.round(v)))
  return {
    ...settings,
    interCallDelayMs: clamp(settings.interCallDelayMs, SETTINGS_BOUNDS.interCallDelayMs),
    ringingTimeoutMs: clamp(settings.ringingTimeoutMs, SETTINGS_BOUNDS.ringingTimeoutMs),
    dialCriteria: sanitizeCriteria(settings.dialCriteria),
    // Recording cannot be on without the consent acknowledgement (story 15).
    recordingEnabled: settings.recordingEnabled === true && !!settings.recordingConsentAt,
    recordingMinSeconds: clamp(
      Number.isFinite(settings.recordingMinSeconds)
        ? settings.recordingMinSeconds
        : DEFAULT_SETTINGS.recordingMinSeconds,
      SETTINGS_BOUNDS.recordingMinSeconds,
    ),
  }
}

/**
 * Story 14 migration: pre-criteria versions stored `dialFilter: DialFilter`.
 * A legacy value lifts into `{ status: dialFilter }` so nobody's setting resets.
 */
export function normalizeStoredSettings(raw: unknown): Settings {
  const stored = (raw ?? {}) as Partial<Settings> & { dialFilter?: DialFilter }
  const dialCriteria =
    stored.dialCriteria ??
    (stored.dialFilter ? { status: stored.dialFilter } : DEFAULT_CRITERIA)
  return clampSettings({ ...DEFAULT_SETTINGS, ...stored, dialCriteria })
}

export const settingsStore = {
  async get(): Promise<Settings> {
    const items = await chrome.storage.local.get(SETTINGS_SLOT)
    return normalizeStoredSettings(items[SETTINGS_SLOT])
  },
  async set(patch: Partial<Settings>): Promise<Settings> {
    const next = clampSettings({ ...(await this.get()), ...patch })
    await chrome.storage.local.set({ [SETTINGS_SLOT]: next })
    return next
  },
  async reset(): Promise<Settings> {
    await chrome.storage.local.set({ [SETTINGS_SLOT]: DEFAULT_SETTINGS })
    return DEFAULT_SETTINGS
  },
}

/** Per-tab resume point (ARCHITECTURE §8) — written by the session, read by S3. */
export interface ResumePoint {
  cursor: number
  updatedAt: string
}

const resumeSlot = (spreadsheetId: string, tabTitle: string) =>
  `resume:${spreadsheetId}:${tabTitle}`

export const resumeStore = {
  async get(spreadsheetId: string, tabTitle: string): Promise<ResumePoint | null> {
    const slot = resumeSlot(spreadsheetId, tabTitle)
    const items = await chrome.storage.local.get(slot)
    return (items[slot] as ResumePoint | undefined) ?? null
  },
  async set(spreadsheetId: string, tabTitle: string, point: ResumePoint): Promise<void> {
    await chrome.storage.local.set({ [resumeSlot(spreadsheetId, tabTitle)]: point })
  },
}
