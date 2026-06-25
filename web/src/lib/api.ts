import type { Business, JobSettings, LocationSpec, ResultQuery } from './types'

async function j<T>(url: string): Promise<T> {
  const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json()
}

function queryString(q: ResultQuery): string {
  const p = new URLSearchParams()
  if (q.q) p.set('q', q.q)
  if (q.category) p.set('category', q.category)
  if (q.minRating != null) p.set('minRating', String(q.minRating))
  if (q.minReviews != null) p.set('minReviews', String(q.minReviews))
  if (q.hasEmail) p.set('hasEmail', '1')
  if (q.hasWebsite) p.set('hasWebsite', '1')
  if (q.hasPhone) p.set('hasPhone', '1')
  if (q.sortBy) { p.set('sortBy', q.sortBy); p.set('sortDir', q.sortDir ?? 'asc') }
  return p.toString()
}

export const api = {
  getCountries: () => j<{ code: string; name: string }[]>('/api/geo/countries'),
  getStates: (country: string) => j<{ code: string; name: string }[]>(`/api/geo/states?country=${country}`),
  getCities: (country: string, state: string) =>
    j<{ name: string }[]>(`/api/geo/cities?country=${country}&state=${state}`),
  getZips: (country: string, state: string, city: string) =>
    j<string[]>(`/api/geo/zips?country=${country}&state=${encodeURIComponent(state)}&city=${encodeURIComponent(city)}`),
  getResults: (offset: number, limit: number, query: ResultQuery) =>
    j<{ rows: Business[]; total: number }>(
      `/api/results?offset=${offset}&limit=${limit}&${queryString(query)}`),
  startJob: (payload: { keywords: string[]; locations: LocationSpec[]; settings: JobSettings }) =>
    fetch('/api/job/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  stopJob: () => fetch('/api/job/stop', { method: 'POST' }),
  clearResults: () => fetch('/api/results/clear', { method: 'POST' }),
  // Streamed straight from the DB on the server — no need to hold rows in the browser.
  exportCsvUrl: () => '/api/export/csv',
}
