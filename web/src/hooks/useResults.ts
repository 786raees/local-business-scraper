import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { api } from '../lib/api'
import type { Business } from '../lib/types'

const PAGE = 100

/**
 * Windowed result access for an arbitrarily large table. Rows are fetched from
 * the server one page at a time and cached; the browser only ever holds the
 * pages it has scrolled near. `liveTotal` (from the WebSocket count) grows the
 * virtual list and invalidates the tail page so new rows appear during a run.
 */
export function useResults(filter: string, liveTotal: number) {
  const [total, setTotal] = useState(0)
  const [, force] = useReducer((x) => x + 1, 0)
  const pages = useRef(new Map<number, Business[]>())
  const loading = useRef(new Set<number>())

  const fetchPage = useCallback(async (p: number) => {
    if (p < 0 || pages.current.has(p) || loading.current.has(p)) return
    loading.current.add(p)
    try {
      const { rows, total: t } = await api.getResults(p * PAGE, PAGE, filter)
      pages.current.set(p, rows)
      setTotal(t)
    } catch { /* leave page unfetched; will retry on next scroll */ }
    finally { loading.current.delete(p); force() }
  }, [filter])

  // Reset and load the first page whenever the filter changes.
  useEffect(() => {
    pages.current.clear(); loading.current.clear(); setTotal(0)
    fetchPage(0)
  }, [filter, fetchPage])

  // Live growth: bump the count and drop the last (partial) page so freshly
  // scraped rows are refetched into the tail.
  useEffect(() => {
    if (liveTotal <= 0) return
    setTotal((t) => Math.max(t, liveTotal))
    pages.current.delete(Math.floor(Math.max(0, liveTotal - 1) / PAGE))
  }, [liveTotal])

  const getRow = useCallback((index: number): Business | undefined => {
    const p = Math.floor(index / PAGE)
    const page = pages.current.get(p)
    if (!page) { void fetchPage(p); return undefined }
    return page[index - p * PAGE]
  }, [fetchPage])

  return { total, getRow }
}
