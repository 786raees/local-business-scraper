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
  facebook: string
  instagram: string
  twitter: string
  linkedin: string
  youtube: string
  tiktok: string
  yelp: string
  yellowpages: string
  ownerName: string
  ownerTitle: string
  ownerSource: string
}

export const SOCIAL_FIELDS = [
  ['facebook', 'FB'], ['instagram', 'IG'], ['twitter', 'X'], ['linkedin', 'IN'],
  ['youtube', 'YT'], ['tiktok', 'TT'], ['yelp', 'Yelp'], ['yellowpages', 'YP'],
] as const

export interface JobSettings {
  maxResults: number
  extractEmail: boolean
  findOwner: boolean
  headless: boolean
  delayMinMs: number
  delayMaxMs: number
}

export interface ResultQuery {
  q?: string
  category?: string
  minRating?: number
  minReviews?: number
  hasEmail?: boolean
  hasWebsite?: boolean
  hasPhone?: boolean
  sortBy?: string
  sortDir?: 'asc' | 'desc'
}

export type TaskStatus = 'queued' | 'running' | 'done' | 'error' | 'blocked'

export type JobEvent =
  | { type: 'task-update'; taskId: string; status: TaskStatus; count?: number; error?: string }
  | { type: 'row'; business: Business }
  | { type: 'count'; total: number }
  | { type: 'progress'; done: number; total: number }
  | { type: 'job-done' }
