import { describe, expect, it } from 'vitest'
import { timeAgo, truncateMiddle } from '../src/shared/format'

const NOW = Date.parse('2026-07-29T12:00:00Z')

describe('timeAgo', () => {
  it.each([
    ['2026-07-29T11:59:40Z', 'just now'],
    ['2026-07-29T11:45:00Z', '15 min ago'],
    ['2026-07-29T11:00:00Z', '1 hour ago'],
    ['2026-07-29T03:00:00Z', '9 hours ago'],
    ['2026-07-28T11:00:00Z', '1 day ago'],
    ['2026-07-27T12:00:00Z', '2 days ago'],
    ['2026-06-01T12:00:00Z', '1 month ago'],
    ['2024-07-29T12:00:00Z', '2 years ago'],
  ])('%s → %s', (iso, expected) => {
    expect(timeAgo(iso, NOW)).toBe(expected)
  })

  it('is empty for missing or unparseable input', () => {
    expect(timeAgo(undefined, NOW)).toBe('')
    expect(timeAgo('garbage', NOW)).toBe('')
  })

  it('never goes negative on clock skew', () => {
    expect(timeAgo('2026-07-29T12:00:05Z', NOW)).toBe('just now')
  })
})

describe('truncateMiddle', () => {
  it('returns short strings unchanged', () => {
    expect(truncateMiddle('bigsky.dental', 34)).toBe('bigsky.dental')
  })

  it('keeps head and tail around an ellipsis at the max length', () => {
    const url = 'www.averyveryverylongdomainname.com/some/deep/page'
    const out = truncateMiddle(url, 30)
    expect(out).toHaveLength(30)
    expect(out).toContain('…')
    expect(out.startsWith('www.avery')).toBe(true)
    expect(out.endsWith('page')).toBe(true)
  })
})
