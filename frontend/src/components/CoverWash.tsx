import { useEffect, useRef, useState } from 'react'

import { artworkUrl } from '../api/client'
import { useLook } from '../hooks/useSeasons'
import { coverWash } from '../lib/seasons'

const SIDE = 32

// Across the top of a page about one cover, behind its head, as nori's desktop draws it: the cover's own
// wash in its own colors, stretched so it is soft, under the page's dyed paper growing from 15 % to whole,
// so the head wears the cover and the foot the season's paper blended with it. Not in Midnight.
export function CoverWash({ template, color, height = 440 }: { template?: string | null; color?: string | null; height?: number }) {
  const look = useLook()
  const canvas = useRef<HTMLCanvasElement | null>(null)
  const [shown, setShown] = useState(false)
  const src = artworkUrl(template, SIDE)

  useEffect(() => {
    setShown(false)
    if (!src || !color) return
    let gone = false
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const c = canvas.current
      const g = c?.getContext('2d', { willReadFrequently: true })
      if (gone || !c || !g) return
      g.drawImage(img, 0, 0, SIDE, SIDE)
      let washed: Uint8ClampedArray | null = null
      try {
        washed = coverWash(g.getImageData(0, 0, SIDE, SIDE).data, SIDE, color)
      } catch {
        /* a cover that cannot be read: no wash */
      }
      if (!washed) return
      g.putImageData(new ImageData(new Uint8ClampedArray(washed), SIDE, SIDE), 0, 0)
      setShown(true)
    }
    img.src = src
    return () => {
      gone = true
    }
  }, [src, color, look])

  if (!src || !color || look.appearance === 'midnight') return null
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
