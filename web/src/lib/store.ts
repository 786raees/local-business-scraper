import { create } from 'zustand'
import type { Business, JobSettings, LocationSpec, JobEvent, TaskStatus } from './types'

interface QueueItem { id: string; status: TaskStatus; count: number; error?: string }

interface State {
  keywords: string[]
  locations: LocationSpec[]
  results: Business[]
  queue: QueueItem[]
  settings: JobSettings
  progress: { done: number; total: number }
  running: boolean
  addKeyword: (k: string) => void
  removeKeyword: (k: string) => void
  addLocation: (l: LocationSpec) => void
  removeLocation: (label: string) => void
  setSettings: (s: Partial<JobSettings>) => void
  setRunning: (r: boolean) => void
  applyEvent: (e: JobEvent) => void
  reset: () => void
}

export const useStore = create<State>((set) => ({
  keywords: [],
  locations: [],
  results: [],
  queue: [],
  settings: { maxResults: 30, extractEmail: false, headless: true, delayMinMs: 600, delayMaxMs: 1500 },
  progress: { done: 0, total: 0 },
  running: false,
  addKeyword: (k) => set((s) => s.keywords.includes(k) || !k.trim() ? s : { keywords: [...s.keywords, k.trim()] }),
  removeKeyword: (k) => set((s) => ({ keywords: s.keywords.filter((x) => x !== k) })),
  addLocation: (l) => set((s) => s.locations.some((x) => x.label === l.label) ? s : { locations: [...s.locations, l] }),
  removeLocation: (label) => set((s) => ({ locations: s.locations.filter((x) => x.label !== label) })),
  setSettings: (p) => set((s) => ({ settings: { ...s.settings, ...p } })),
  setRunning: (r) => set({ running: r }),
  reset: () => set({ results: [], queue: [], progress: { done: 0, total: 0 } }),
  applyEvent: (e) => set((s) => {
    if (e.type === 'row') return { results: [...s.results, e.business] }
    if (e.type === 'progress') return { progress: { done: e.done, total: e.total } }
    if (e.type === 'job-done') return { running: false }
    if (e.type === 'task-update') {
      const exists = s.queue.some((q) => q.id === e.taskId)
      const queue = exists
        ? s.queue.map((q) => q.id === e.taskId ? { ...q, status: e.status, count: e.count ?? q.count, error: e.error } : q)
        : [...s.queue, { id: e.taskId, status: e.status, count: e.count ?? 0, error: e.error }]
      return { queue }
    }
    return s
  }),
}))
