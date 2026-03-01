import { useCallback, useEffect, useRef, useState } from 'react'

type ServerMessage =
  | { type: 'welcome'; id: string; peers: string[] }
  | { type: 'peer-joined'; peerId: string }
  | { type: 'peer-left'; peerId: string }
  | {
      type: 'signal'
      from: string
      payload: RTCSessionDescriptionInit | RTCIceCandidateInit
    }

const RTC_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
}

interface PeerState {
  connection: RTCPeerConnection
  stream: MediaStream
  candidateBuffer: RTCIceCandidateInit[]
  remoteDescriptionSet: boolean
}

function getSignalingUrl() {
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}/websocket`
}

export function useWebRTC({
  signalingUrl = getSignalingUrl(),
  initialAudioEnabled = true,
  initialVideoEnabled = true,
}: {
  signalingUrl?: string
  initialAudioEnabled?: boolean
  initialVideoEnabled?: boolean
} = {}) {
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [peers, setPeers] = useState<Map<string, MediaStream>>(new Map())
  const [isAudioEnabled, setIsAudioEnabled] = useState(initialAudioEnabled)
  const [isVideoEnabled, setIsVideoEnabled] = useState(initialVideoEnabled)

  const wsRef = useRef<WebSocket | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const peersRef = useRef<Map<string, PeerState>>(new Map())
  const myIdRef = useRef<string>('')

  const sendSignal = useCallback((to: string, payload: unknown) => {
    wsRef.current?.send(JSON.stringify({ type: 'signal', to, payload }))
  }, [])

  const updatePeersState = useCallback(() => {
    const streamMap = new Map<string, MediaStream>()
    for (const [id, peer] of peersRef.current) {
      streamMap.set(id, peer.stream)
    }
    setPeers(new Map(streamMap))
  }, [])

  const createPeerConnection = useCallback(
    (peerId: string): PeerState => {
      const connection = new RTCPeerConnection(RTC_CONFIG)
      const stream = new MediaStream()
      const state: PeerState = {
        connection,
        stream,
        candidateBuffer: [],
        remoteDescriptionSet: false,
      }

      // Add local tracks to the connection
      if (localStreamRef.current) {
        for (const track of localStreamRef.current.getTracks()) {
          connection.addTrack(track, localStreamRef.current)
        }
      }

      // Handle incoming tracks
      connection.ontrack = (event) => {
        for (const track of event.streams[0]?.getTracks() ?? []) {
          stream.addTrack(track)
        }
        updatePeersState()
      }

      // Send ICE candidates to the remote peer
      connection.onicecandidate = (event) => {
        if (event.candidate) {
          sendSignal(peerId, event.candidate.toJSON())
        }
      }

      connection.onconnectionstatechange = () => {
        if (
          connection.connectionState === 'disconnected' ||
          connection.connectionState === 'failed'
        ) {
          removePeer(peerId)
        }
      }

      peersRef.current.set(peerId, state)
      return state
    },
    [sendSignal, updatePeersState],
  )

  const removePeer = useCallback(
    (peerId: string) => {
      const peer = peersRef.current.get(peerId)
      if (peer) {
        peer.connection.close()
        peersRef.current.delete(peerId)
        updatePeersState()
      }
    },
    [updatePeersState],
  )

  const flushCandidates = useCallback(async (state: PeerState) => {
    for (const candidate of state.candidateBuffer) {
      await state.connection.addIceCandidate(new RTCIceCandidate(candidate))
    }
    state.candidateBuffer = []
  }, [])

  const handleMessage = useCallback(
    async (event: MessageEvent) => {
      const data = JSON.parse(event.data as string) as ServerMessage

      switch (data.type) {
        case 'welcome': {
          myIdRef.current = data.id
          // Create offers for all existing peers (we are the polite side initiating)
          for (const peerId of data.peers) {
            const state = createPeerConnection(peerId)
            const offer = await state.connection.createOffer()
            await state.connection.setLocalDescription(offer)
            sendSignal(peerId, state.connection.localDescription!.toJSON())
          }
          updatePeersState()
          break
        }

        case 'peer-joined': {
          // Don't create a connection yet — wait for their offer
          break
        }

        case 'signal': {
          const { from, payload } = data

          // Determine if this is an SDP or ICE candidate
          if ('sdp' in payload) {
            const sdp = payload

            if (sdp.type === 'offer') {
              // Incoming offer — create connection and send answer
              const state = createPeerConnection(from)
              await state.connection.setRemoteDescription(
                new RTCSessionDescription(sdp),
              )
              state.remoteDescriptionSet = true
              await flushCandidates(state)
              const answer = await state.connection.createAnswer()
              await state.connection.setLocalDescription(answer)
              sendSignal(from, state.connection.localDescription!.toJSON())
            } else if (sdp.type === 'answer') {
              // Incoming answer — set remote description on existing connection
              const state = peersRef.current.get(from)
              if (state) {
                await state.connection.setRemoteDescription(
                  new RTCSessionDescription(sdp),
                )
                state.remoteDescriptionSet = true
                await flushCandidates(state)
              }
            }
          } else if ('candidate' in payload) {
            // ICE candidate
            const state = peersRef.current.get(from)
            if (state) {
              if (state.remoteDescriptionSet) {
                await state.connection.addIceCandidate(
                  new RTCIceCandidate(payload),
                )
              } else {
                state.candidateBuffer.push(payload)
              }
            }
          }
          break
        }

        case 'peer-left': {
          removePeer(data.peerId)
          break
        }
      }
    },
    [
      createPeerConnection,
      sendSignal,
      removePeer,
      flushCandidates,
      updatePeersState,
    ],
  )

  useEffect(() => {
    let ws: WebSocket
    let stream: MediaStream

    const init = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        })
      } catch {
        // Fall back to no media if permissions denied
        stream = new MediaStream()
      }

      for (const track of stream.getAudioTracks()) {
        track.enabled = initialAudioEnabled
      }
      for (const track of stream.getVideoTracks()) {
        track.enabled = initialVideoEnabled
      }

      localStreamRef.current = stream
      setLocalStream(stream)

      ws = new WebSocket(signalingUrl)
      wsRef.current = ws
      ws.onmessage = handleMessage
      ws.onopen = () => ws.send(JSON.stringify({ type: 'ready' }))
    }

    init()

    return () => {
      // Close all peer connections
      for (const [, peer] of peersRef.current) {
        peer.connection.close()
      }
      peersRef.current.clear()

      // Stop local tracks
      localStreamRef.current?.getTracks().forEach((t) => t.stop())
      localStreamRef.current = null

      // Close WebSocket
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [signalingUrl, handleMessage])

  const toggleAudio = useCallback(() => {
    if (!localStreamRef.current) return
    for (const track of localStreamRef.current.getAudioTracks()) {
      track.enabled = !track.enabled
    }
    setIsAudioEnabled((prev) => !prev)
  }, [])

  const toggleVideo = useCallback(() => {
    if (!localStreamRef.current) return
    for (const track of localStreamRef.current.getVideoTracks()) {
      track.enabled = !track.enabled
    }
    setIsVideoEnabled((prev) => !prev)
  }, [])

  return {
    localStream,
    peers,
    isAudioEnabled,
    isVideoEnabled,
    toggleAudio,
    toggleVideo,
  }
}
