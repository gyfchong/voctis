import { DurableObject } from 'cloudflare:workers'

interface Env {
  SIGNALING_ROOM: DurableObjectNamespace<SignalingRoom>
  ASSETS: Fetcher
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/websocket') {
      const id = env.SIGNALING_ROOM.idFromName('default-room')
      const room = env.SIGNALING_ROOM.get(id)
      return room.fetch(request)
    }

    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>

interface Attachment {
  id: string
}

type ServerMessage =
  | { type: 'welcome'; id: string; peers: string[] }
  | { type: 'peer-joined'; peerId: string }
  | { type: 'peer-left'; peerId: string }
  | { type: 'signal'; from: string; payload: unknown }

type ClientMessage =
  | { type: 'ready' }
  | { type: 'signal'; to: string; payload: unknown }

export class SignalingRoom extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Expected WebSocket', { status: 426 })
    }

    const pair = new WebSocketPair()
    const [client, server] = [pair[0], pair[1]]

    const id = crypto.randomUUID()
    this.ctx.acceptWebSocket(server)
    server.serializeAttachment({ id } satisfies Attachment)

    return new Response(null, { status: 101, webSocket: client })
  }

  async webSocketMessage(
    ws: WebSocket,
    message: string | ArrayBuffer,
  ): Promise<void> {
    if (typeof message !== 'string') return

    let data: ClientMessage
    try {
      data = JSON.parse(message) as ClientMessage
    } catch {
      return
    }

    const from = (ws.deserializeAttachment() as Attachment).id

    if (data.type === 'ready') {
      // Client is ready — send welcome with existing peers and notify others
      const peerIds: string[] = []
      for (const peer of this.ctx.getWebSockets()) {
        if (peer === ws) continue
        const attachment = peer.deserializeAttachment() as Attachment
        peerIds.push(attachment.id)
        this.send(peer, { type: 'peer-joined', peerId: from })
      }
      this.send(ws, { type: 'welcome', id: from, peers: peerIds })
      return
    }

    if (!data.to) return

    // Find the target peer's WebSocket
    for (const peer of this.ctx.getWebSockets()) {
      const attachment = peer.deserializeAttachment() as Attachment
      if (attachment.id === data.to) {
        this.send(peer, { type: 'signal', from, payload: data.payload })
        break
      }
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const attachment = ws.deserializeAttachment() as Attachment

    // Broadcast peer-left to remaining connections
    for (const peer of this.ctx.getWebSockets()) {
      if (peer === ws) continue
      this.send(peer, { type: 'peer-left', peerId: attachment.id })
    }

    ws.close()
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    await this.webSocketClose(ws)
  }

  private send(ws: WebSocket, message: ServerMessage): void {
    ws.send(JSON.stringify(message))
  }
}
