import { createFileRoute } from '@tanstack/react-router'
import { Mic, MicOff, Video, VideoOff } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { VideoTile } from '../components/video-tile'
import { useWebRTC } from '../hooks/use-webrtc'

export const Route = createFileRoute('/')({ component: Room })

function Room() {
  const [joined, setJoined] = useState(false)
  const [initialAudio, setInitialAudio] = useState(true)
  const [initialVideo, setInitialVideo] = useState(true)

  if (!joined) {
    return (
      <PreJoinDialog
        onJoin={(audio, video) => {
          setInitialAudio(audio)
          setInitialVideo(video)
          setJoined(true)
        }}
      />
    )
  }

  return <CallRoom initialAudioEnabled={initialAudio} initialVideoEnabled={initialVideo} />
}

function PreJoinDialog({ onJoin }: { onJoin: (audio: boolean, video: boolean) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [audioEnabled, setAudioEnabled] = useState(true)
  const [videoEnabled, setVideoEnabled] = useState(true)
  const [previewStream, setPreviewStream] = useState<MediaStream | null>(null)

  useEffect(() => {
    dialogRef.current?.showModal()

    let stream: MediaStream
    const getMedia = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
        setPreviewStream(stream)
      } catch {
        setPreviewStream(null)
      }
    }

    getMedia()

    return () => {
      stream?.getTracks().forEach((t) => t.stop())
    }
  }, [])

  useEffect(() => {
    if (!previewStream) return
    for (const track of previewStream.getAudioTracks()) {
      track.enabled = audioEnabled
    }
  }, [audioEnabled, previewStream])

  const handleJoin = () => {
    previewStream?.getTracks().forEach((t) => t.stop())
    dialogRef.current?.close()
    onJoin(audioEnabled, videoEnabled)
  }

  return (
    <div className="flex h-screen items-center justify-center bg-neutral-950">
      <dialog
        ref={dialogRef}
        className="m-auto w-[360px] rounded-2xl bg-neutral-900 p-6 text-white backdrop:bg-black/70"
      >
        <h2 className="mb-4 text-center text-lg font-semibold">Ready to join?</h2>

        <div className="mb-4 overflow-hidden rounded-xl bg-neutral-800">
          <VideoTile stream={videoEnabled ? previewStream : null} muted label="You" />
        </div>

        <div className="mb-6 flex items-center justify-center gap-3">
          <button
            onClick={() => setAudioEnabled((a) => !a)}
            className={`rounded-full p-3 text-white transition-colors ${
              audioEnabled ? 'bg-neutral-700 hover:bg-neutral-600' : 'bg-red-600 hover:bg-red-500'
            }`}
          >
            {audioEnabled ? <Mic size={20} /> : <MicOff size={20} />}
          </button>
          <button
            onClick={() => setVideoEnabled((v) => !v)}
            className={`rounded-full p-3 text-white transition-colors ${
              videoEnabled ? 'bg-neutral-700 hover:bg-neutral-600' : 'bg-red-600 hover:bg-red-500'
            }`}
          >
            {videoEnabled ? <Video size={20} /> : <VideoOff size={20} />}
          </button>
        </div>

        <button
          onClick={handleJoin}
          className="w-full rounded-full bg-blue-600 py-3 font-medium text-white transition-colors hover:bg-blue-500"
        >
          Join Room
        </button>
      </dialog>
    </div>
  )
}

function CallRoom({
  initialAudioEnabled,
  initialVideoEnabled,
}: {
  initialAudioEnabled: boolean
  initialVideoEnabled: boolean
}) {
  const { localStream, peers, isAudioEnabled, isVideoEnabled, toggleAudio, toggleVideo } =
    useWebRTC({ initialAudioEnabled, initialVideoEnabled })

  return (
    <div className="flex h-screen flex-col bg-neutral-950">
      <div className="grid flex-1 auto-rows-fr gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
        <VideoTile stream={localStream} muted label="You" />
        {[...peers].map(([id, stream]) => (
          <VideoTile key={id} stream={stream} label={id.slice(0, 8)} />
        ))}
      </div>

      <div className="flex items-center justify-center gap-3 p-4">
        <button
          onClick={toggleAudio}
          className={`rounded-full p-3 text-white transition-colors ${
            isAudioEnabled ? 'bg-neutral-700 hover:bg-neutral-600' : 'bg-red-600 hover:bg-red-500'
          }`}
        >
          {isAudioEnabled ? <Mic size={20} /> : <MicOff size={20} />}
        </button>
        <button
          onClick={toggleVideo}
          className={`rounded-full p-3 text-white transition-colors ${
            isVideoEnabled ? 'bg-neutral-700 hover:bg-neutral-600' : 'bg-red-600 hover:bg-red-500'
          }`}
        >
          {isVideoEnabled ? <Video size={20} /> : <VideoOff size={20} />}
        </button>
      </div>
    </div>
  )
}
