import { WebSocketServer, WebSocket } from 'ws'
import type { Server } from 'node:http'
import { JobEvent } from '../types.js'

export class WsHub {
  private wss: WebSocketServer
  constructor(server: Server) {
    this.wss = new WebSocketServer({ server, path: '/ws' })
  }
  broadcast(event: JobEvent): void {
    const msg = JSON.stringify(event)
    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) client.send(msg)
    }
  }
}
