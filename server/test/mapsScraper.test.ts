import { describe, it, expect } from 'vitest'
import {
  partitionUrls, advanceFeedProgress, feedExhausted, FeedProgress,
} from '../src/scraper/mapsScraper.js'

// Real-shaped Maps place URLs: identity lives in the !19s segment.
const url = (id: string) => `https://www.google.com/maps/place/Acme/@51.5,-0.1,15z/data=!3m1!4b1!19s${id}?hl=en`
const NO_ID = 'https://www.google.com/maps/place/Acme/@51.5,-0.1,15z'

describe('partitionUrls — dedup before navigation (story 06)', () => {
  it('routes known place ids away from the detail visit', () => {
    const isKnown = (id: string) => id === 'ChIJknown'
    const { fresh, known } = partitionUrls([url('ChIJknown'), url('ChIJnew')], isKnown)
    expect(known).toEqual([url('ChIJknown')])
    expect(fresh).toEqual([url('ChIJnew')])
  })

  it('always visits a URL whose place id cannot be parsed', () => {
    const { fresh, known } = partitionUrls([NO_ID], () => true)
    expect(fresh).toEqual([NO_ID])
    expect(known).toEqual([])
  })

  it('with nothing known, everything is fresh', () => {
    const urls = [url('a'), url('b'), NO_ID]
    expect(partitionUrls(urls, () => false).fresh).toEqual(urls)
  })
})

describe('scroll-loop stop conditions (story 06)', () => {
  const start: FeedProgress = { stagnant: 0, knownRounds: 0 }

  it('stops after four rounds with no new links at all', () => {
    let p = start
    for (let i = 0; i < 4; i++) {
      expect(feedExhausted(p)).toBe(false)
      p = advanceFeedProgress(p, 0, 0)
    }
    expect(feedExhausted(p)).toBe(true)
  })

  it('stops after two consecutive rounds of only already-known places', () => {
    let p = advanceFeedProgress(start, 10, 0)   // new links, all known
    expect(feedExhausted(p)).toBe(false)
    p = advanceFeedProgress(p, 10, 0)
    expect(feedExhausted(p)).toBe(true)
  })

  it('a single fresh find resets the all-known streak', () => {
    let p = advanceFeedProgress(start, 10, 0)
    p = advanceFeedProgress(p, 10, 1)           // one fresh place — keep scrolling
    p = advanceFeedProgress(p, 10, 0)
    expect(feedExhausted(p)).toBe(false)
  })

  it('an empty round does not count toward the all-known streak', () => {
    let p = advanceFeedProgress(start, 10, 0)
    p = advanceFeedProgress(p, 0, 0)            // feed hiccup, nothing rendered
    expect(p.knownRounds).toBe(1)
    expect(feedExhausted(p)).toBe(false)
  })
})
