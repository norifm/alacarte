import { useEffect, useSyncExternalStore } from 'react'

import { getLook, releaseCoverTint, setCoverTint, subscribeSeasons } from '../lib/seasons'

/** The look worn (season and appearance); re-renders when it changes. */
export function useLook() {
  return useSyncExternalStore(subscribeSeasons, getLook)
}

/** While a page about one cover is open, the page and the chrome wear the cover's color (`rrggbb`). */
export function useCoverTint(color: string | null | undefined) {
  useEffect(() => {
    if (color) setCoverTint(color)
  }, [color])
  useEffect(() => () => releaseCoverTint(), [])
}
