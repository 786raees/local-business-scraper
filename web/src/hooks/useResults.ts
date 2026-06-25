import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { api } from '../lib/api'
import type { Business, ResultQuery } from '../lib/types'

const PAGE = 100

/**
 * Windowed result access for an arbitrarily large table. Rows are fetched from
 * the server one page at a time and cached; the browser only ever holds the
 * pages it has scrolled near. `liveTotal` (from the WebSocket count) grows the
 * virtual list and invalidates the tail page so new rows appear during a run;
 * a drop in `liveTotal` (e.g. Clear or a new run) resets the cache.
 */
export function useResults(query: ResultQuery, liveTotal: number) {
  const [total, setTotal] = useState(0)
  const [, force] = useReducer((x) => x + 1, 0)
  const pages = useRef(new Map<number, Business[]>())
  const loading = useRef(new Set<number>())
  const prevLive = useRef(0)
  const key = JSON.stringify(query)

  const fetchPage = useCallback(async (p: number) => {
    if (p < 0 || pages.current.has(p) || loading.current.has(p)) return
    loading.current.add(p)
    try {
      const { rows, total: t } = await api.getResults(p * PAGE, PAGE, query)
      pages.current.set(p, rows)
      setTotal(t)
    } catch { /* leave page unfetched; retry on next scroll */ }
    finally { loading.current.delete(p); force() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const resetAndLoad = useCallback(() => {
    pages.current.clear(); loading.current.clear(); setTotal(0)
    fetchPage(0)
  }, [fetchPage])

  // Reset and reload whenever the query (filter/sort) changes.
  useEffect(() => { resetAndLoad() }, [key, resetAndLoad])

  // React to live total: grow on increase, full reset on decrease (clear/new run).
  useEffect(() => {
    if (liveTotal < prevLive.current) {
      resetAndLoad()
    } else if (liveTotal > 0) {
      setTotal((t) => Math.max(t, liveTotal))
      pages.current.delete(Math.floor(Math.max(0, liveTotal - 1) / PAGE))
    }
    prevLive.current = liveTotal
  }, [liveTotal, resetAndLoad])

  const getRow = useCallback((index: number): Business | undefined => {
    const p = Math.floor(index / PAGE)
    const page = pages.current.get(p)
    if (!page) { void fetchPage(p); return undefined }
    return page[index - p * PAGE]
  }, [fetchPage])

  return { total, getRow }
}
