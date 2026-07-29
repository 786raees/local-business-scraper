/**
 * Middle-truncate a URL for the lead card's website cell (DESIGN §6.4):
 * keeps the host and the path tail, elides the middle.
 */
export function truncateMiddle(text: string, max: number): string {
  if (text.length <= max) return text
  const keep = max - 1
  const head = Math.ceil(keep / 2)
  const tail = keep - head
  return `${text.slice(0, head)}…${tail > 0 ? text.slice(-tail) : ''}`
}

/** "modified 2 days ago" style relative time for picker rows (UX S1). */
export function timeAgo(iso: string | undefined, nowMs: number = Date.now()): string {
  if (!iso) return ''
  const then = Date.parse(iso)
  if (Number.isNaN(then)) return ''
  const sec = Math.max(0, Math.floor((nowMs - then) / 1000))
  if (sec < 60) return 'just now'
  const min = Math.floor(sec / 60)
  if (min < 60) return `${min} min ago`
  const hours = Math.floor(min / 60)
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`
  const days = Math.floor(hours / 24)
  if (days < 30) return days === 1 ? '1 day ago' : `${days} days ago`
  const months = Math.floor(days / 30)
  if (months < 12) return months === 1 ? '1 month ago' : `${months} months ago`
  const years = Math.floor(months / 12)
  return years === 1 ? '1 year ago' : `${years} years ago`
}
