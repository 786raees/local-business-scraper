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
  startJob: (payload: { keywords: string[]; locations: LocationSpec[]; settings: JobSettings }) =>
    fetch('/api/job/start', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
  stopJob: () => fetch('/api/job/stop', { method: 'POST' }),
  exportCsv: async (rows: Business[], columns?: (keyof Business)[]) => {
    const r = await fetch('/api/export/csv', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rows, columns }),
    })
    const blob = await r.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'results.csv'; a.click()
    URL.revokeObjectURL(url)
  },
}
