import { useSyncExternalStore } from 'react'

import { getLook, subscribeSeasons } from '../lib/seasons'

/** The look worn (season and appearance); re-renders when it changes. */
export function useLook() {
  return useSyncExternalStore(subscribeSeasons, getLook)
}
