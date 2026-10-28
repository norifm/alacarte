import { artworkUrl } from '../api/client'
import { useLook } from '../hooks/useSeasons'

// Across the top of a page about one cover, behind its head: the cover drawn tiny and stretched, so it is
// already soft, under the page's paper growing from 15 % to whole. Not in Midnight, which wears no
// cover colors.
export function CoverWash({ template, height = 440 }: { template?: string | null; height?: number }) {
  const { appearance } = useLook()
  const src = artworkUrl(template, 32)
  if (!src || appearance === 'midnight') return null
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-x-0 top-0 -z-10 overflow-hidden animate-[dots-in_400ms_ease-out]"
      style={{ height }}
    >
      <img src={src} alt="" className="h-full w-full scale-125 object-cover blur-2xl" />
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
