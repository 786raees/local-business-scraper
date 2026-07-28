import { create } from 'zustand'
import type { JobSettings, LocationSpec, JobEvent, TaskStatus } from './types'

interface QueueItem { id: string; status: TaskStatus; count: number; error?: string; label?: string }

interface State {
  keywords: string[]
  locations: LocationSpec[]
  total: number          // unique rows stored, reported by the server
  duplicates: number     // repeat sightings skipped — expected to be high when segmenting
  queue: QueueItem[]
  settings: JobSettings
  progress: { done: number; total: number }
  running: boolean
  /** placeIds of rows the user has ticked for export. */
  selected: Set<string>
  /** Row index of the last checkbox click — the anchor for shift-range selection. */
  lastClickedIndex: number | null
  addKeyword: (k: string) => void
  removeKeyword: (k: string) => void
  addLocation: (l: LocationSpec) => void
  removeLocation: (label: string) => void
  setSettings: (s: Partial<JobSettings>) => void
  setRunning: (r: boolean) => void
  applyEvent: (e: JobEvent) => void
  reset: () => void
  toggleOne: (placeId: string, index: number) => void
  setSelected: (ids: string[], on: boolean, anchorIndex?: number) => void
  clearSelection: () => void
}

export const useStore = create<State>((set) => ({
  keywords: [],
  locations: [],
  total: 0,
  duplicates: 0,
  queue: [],
  settings: {
    maxResults: 30, extractEmail: false, findOwner: false, headless: true,
    delayMinMs: 600, delayMaxMs: 1500,
    segment: false, tileKm: 5, maxTiles: 400,
  },
  progress: { done: 0, total: 0 },
  running: false,
  addKeyword: (k) => set((s) => s.keywords.includes(k) || !k.trim() ? s : { keywords: [...s.keywords, k.trim()] }),
  removeKeyword: (k) => set((s) => ({ keywords: s.keywords.filter((x) => x !== k) })),
  addLocation: (l) => set((s) => s.locations.some((x) => x.label === l.label) ? s : { locations: [...s.locations, l] }),
  removeLocation: (label) => set((s) => ({ locations: s.locations.filter((x) => x.label !== label) })),
  setSettings: (p) => set((s) => ({ settings: { ...s.settings, ...p } })),
  setRunning: (r) => set({ running: r }),
  selected: new Set<string>(),
  lastClickedIndex: null,
  toggleOne: (placeId, index) => set((s) => {
    const selected = new Set(s.selected)
    if (selected.has(placeId)) selected.delete(placeId)
    else selected.add(placeId)
    return { selected, lastClickedIndex: index }
  }),
  setSelected: (ids, on, anchorIndex) => set((s) => {
    const selected = new Set(s.selected)
    for (const id of ids) { if (on) selected.add(id); else selected.delete(id) }
    return { selected, ...(anchorIndex !== undefined ? { lastClickedIndex: anchorIndex } : {}) }
  }),
  clearSelection: () => set({ selected: new Set<string>(), lastClickedIndex: null }),
  reset: () => set({
    total: 0, duplicates: 0, queue: [], progress: { done: 0, total: 0 },
    selected: new Set<string>(), lastClickedIndex: null,
  }),
  applyEvent: (e) => set((s) => {
    if (e.type === 'count') return { total: e.total, duplicates: e.duplicates ?? 0 }
    if (e.type === 'progress') return { progress: { done: e.done, total: e.total } }
    if (e.type === 'job-done') return { running: false }
    if (e.type === 'task-update') {
      const exists = s.queue.some((q) => q.id === e.taskId)
      const queue = exists
        ? s.queue.map((q) => q.id === e.taskId
          ? { ...q, status: e.status, count: e.count ?? q.count, error: e.error, label: e.label ?? q.label }
          : q)
        : [...s.queue, { id: e.taskId, status: e.status, count: e.count ?? 0, error: e.error, label: e.label }]
      return { queue }
    }
    return s
  }),
}))
