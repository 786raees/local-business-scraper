import type { Business, JobSettings, LocationSpec } from './types'

async function j<T>(url: string): Promise<T> {
  const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json()
}

export const api = {
  getCountries: () => j<{ code: string; name: string }[]>('/api/geo/countries'),
  getStates: (country: string) => j<{ code: string; name: string }[]>(`/api/geo/states?country=${country}`),
  getCities: (country: string, state: string) =>
    j<{ name: string }[]>(`/api/geo/cities?country=${country}&state=${state}`),
  getZips: (country: string, state: string, city: string) =>
    j<string[]>(`/api/geo/zips?country=${country}&state=${encodeURIComponent(state)}&city=${encodeURIComponent(city)}`),
  getResults: (offset: number, limit: number, filter: string) =>
    j<{ rows: Business[]; total: number }>(
      `/api/results?offset=${offset}&limit=${limit}&filter=${encodeURIComponent(filter)}`),
  startJob: (payload: { keywords: string[]; locations: LocationSpec[]; settings: JobSettings }) =>
    fetch('/api/job/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  stopJob: () => fetch('/api/job/stop', { method: 'POST' }),
  // Streamed straight from the DB on the server — no need to hold rows in the browser.
  exportCsvUrl: () => '/api/export/csv',
}
