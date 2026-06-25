export interface LocationSpec {
  country: string
  state: string
  city: string
  zip: string | null
  label: string
}

export const SOCIAL_PLATFORMS = [
  'facebook', 'instagram', 'twitter', 'linkedin', 'youtube', 'tiktok', 'yelp', 'yellowpages',
] as const
export type SocialPlatform = (typeof SOCIAL_PLATFORMS)[number]
export type Socials = Record<SocialPlatform, string>

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

export interface JobSettings {
  maxResults: number
  extractEmail: boolean
  findOwner: boolean
  headless: boolean
  delayMinMs: number
  delayMaxMs: number
}

export interface TaskSpec {
  id: string
  keyword: string
  location: LocationSpec
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

export function emptyBusiness(keyword: string, location: string): Business {
  return {
    name: '', address: '', phone: '', website: '', rating: null, reviewCount: null,
    priceLevel: '', category: '', hours: '', email: '', mapsUrl: '', keyword, location,
    facebook: '', instagram: '', twitter: '', linkedin: '', youtube: '', tiktok: '',
    yelp: '', yellowpages: '',
    ownerName: '', ownerTitle: '', ownerSource: '',
  }
}
