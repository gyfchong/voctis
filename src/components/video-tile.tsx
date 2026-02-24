import { useEffect, useRef } from 'react'

interface VideoTileProps {
  stream: MediaStream | null
  muted?: boolean
  label: string
}

export function VideoTile({ stream, muted = false, label }: VideoTileProps) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.srcObject = stream
    }
  }, [stream])

  return (
    <div className="relative aspect-video overflow-hidden rounded-xl bg-neutral-900">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted={muted}
        className="h-full w-full object-cover"
      />
      <span className="absolute bottom-2 left-2 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
        {label}
      </span>
    </div>
  )
}
