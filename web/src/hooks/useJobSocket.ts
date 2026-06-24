import { useEffect } from 'react'
import { useStore } from '../lib/store'
import type { JobEvent } from '../lib/types'

export function useJobSocket(): void {
  useEffect(() => {
    let ws: WebSocket
    let closed = false
    const connect = () => {
      ws = new WebSocket(`ws://${location.host}/ws`)
      ws.onmessage = (ev) => {
        try { useStore.getState().applyEvent(JSON.parse(ev.data) as JobEvent) } catch { /* ignore */ }
      }
      ws.onclose = () => { if (!closed) setTimeout(connect, 1500) }
    }
    connect()
    return () => { closed = true; ws?.close() }
  }, [])
}
