export interface LocationSpec {
  country: string
  state: string
  city: string
  zip: string | null
  label: string
}

export interface Business {
  name: string
  address: string
  phone: string
  website: string
  rating: number | null
  reviewCount: number | null
  priceLevel: string
  category: string
  hours: string
  email: string
  mapsUrl: string
  keyword: string
  location: string
}

export interface JobSettings {
  maxResults: number
  extractEmail: boolean
  headless: boolean
  delayMinMs: number
  delayMaxMs: number
}

export interface TaskSpec {
  id: string
  keyword: string
  location: LocationSpec
}

export type TaskStatus = 'queued' | 'running' | 'done' | 'error' | 'blocked'

export type JobEvent =
  | { type: 'task-update'; taskId: string; status: TaskStatus; count?: number; error?: string }
  | { type: 'row'; business: Business }
  | { type: 'progress'; done: number; total: number }
  | { type: 'job-done' }

export function emptyBusiness(keyword: string, location: string): Business {
  return {
    name: '', address: '', phone: '', website: '', rating: null, reviewCount: null,
    priceLevel: '', category: '', hours: '', email: '', mapsUrl: '', keyword, location,
  }
}
