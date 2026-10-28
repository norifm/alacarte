import { useEffect, useRef, useState } from 'react'

import { artworkUrl } from '../api/client'
import { useLook } from '../hooks/useSeasons'
import { coverColors, releaseCoverTint, setCoverTint } from '../lib/seasons'

const SIDE = 32

// A page about one cover, as nori's desktop draws it: the page and the chrome wear the season's paper dyed
// with the cover's own edge (worked out from its pixels), and across the top, behind the head, lies the
// cover's own wash in its own colors, stretched so it is soft, under the dyed paper growing from 15 % to
// whole. Midnight wears no cover colors.
export function CoverWash({ template, height = 440 }: { template?: string | null; height?: number }) {
  const look = useLook()
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const [shown, setShown] = useState(false)
  const src = artworkUrl(template, SIDE)

  useEffect(() => {
    setShown(false)
    if (!src) return
    let gone = false
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const c = canvas.current
      const g = c?.getContext('2d', { willReadFrequently: true })
      if (gone || !c || !g) return
      g.drawImage(img, 0, 0, SIDE, SIDE)
      try {
        const { edge, wash } = coverColors(g.getImageData(0, 0, SIDE, SIDE).data, SIDE)
        setCoverTint(edge)
        g.putImageData(new ImageData(new Uint8ClampedArray(wash), SIDE, SIDE), 0, 0)
        setShown(true)
      } catch {
        /* a cover that cannot be read: the season's paper */
      }
    }
    img.src = src
    return () => {
      gone = true
    }
  }, [src])

  useEffect(() => () => releaseCoverTint(), [])

  if (!src || look.appearance === 'midnight') return null
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-x-0 top-0 -z-10 overflow-hidden transition-opacity duration-[400ms] ease-out ${shown ? 'opacity-100' : 'opacity-0'}`}
      style={{ height }}
    >
      <canvas ref={canvas} width={SIDE} height={SIDE} className="h-full w-full scale-110 blur-lg" />
      <div
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(color-mix(in srgb, var(--page) 15%, transparent), color-mix(in srgb, var(--page) 55%, transparent) 55%, var(--page))',
        }}
      />
    </div>
  )
}
