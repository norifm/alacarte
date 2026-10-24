import {
  albumFromNormalized,
  getCurator,
  getRecordLabel,
  normalizeAlbum,
  normalizePlaylist,
  playlistFromNormalized,
} from './appleApi.mjs'
import { filterAlbumsByRating } from './contentRatingFilter.mjs'
import { decodeEntities } from './ttmlLrc.mjs'

// Pages seen lately are served again without asking apple; a list cut short by
// a failed page is not kept.
const CACHE_TTL_MS = 30 * 60 * 1000
const CACHE_MAX = 100
const cache = new Map()

async function cached(key, load) {
  const hit = cache.get(key)
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value
  cache.delete(key)
  const { value, complete } = await load()
  if (value && complete) {
    cache.set(key, { at: Date.now(), value })
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value)
  }
  return value
}

function header(item, description) {
  const a = item.attributes || {}
  return {
    id: item.id,
    name: a.name,
    description: decodeEntities(String(description || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim(),
    url: a.url,
    artworkTemplate: a.artwork?.url || null,
    artworkColor: a.artwork?.bgColor || null,
  }
}

export function loadCurator({ id, storefront, language }) {
  return cached(`curator|${storefront}|${language}|${id}`, async () => {
    const raw = await getCurator({ storefront, id, language })
    const item = raw?.data?.[0]
    if (!item) return { value: null }
    const notes = item.attributes?.editorialNotes
    const value = {
      curator: header(item, notes?.standard || notes?.short),
      playlists: (item.relationships?.playlists?.data || [])
        .filter((p) => p.attributes)
        .map((p) => playlistFromNormalized(normalizePlaylist(p))),
    }
    return { value, complete: !raw.partial }
  })
}

export function loadRecordLabel({ id, storefront, language, explicitFilter }) {
  return cached(`label|${storefront}|${language}|${explicitFilter || 'explicit'}|${id}`, async () => {
    const raw = await getRecordLabel({ storefront, id, language })
    const item = raw?.data?.[0]
    if (!item) return { value: null }
    const uniqueById = (list) => {
      const seen = new Set()
      return list.filter((x) => !seen.has(x.id) && seen.add(x.id))
    }
    const [latest, top] = ['latest-releases', 'top-releases'].map((name) =>
      uniqueById((item.views?.[name]?.data || []).filter((x) => x.attributes)).map((x) =>
        albumFromNormalized(normalizeAlbum(x)),
      ),
    )
    const filter = (albums) => filterAlbumsByRating(albums, explicitFilter || 'explicit')
    const value = {
      label: header(item, item.attributes?.description?.standard),
      latestReleases: filter(latest),
      topReleases: filter(top),
      // both views in one list with clean and explicit versions settled across
      // them, so download multiple offers each album once
      albums: filter(uniqueById([...latest, ...top])),
    }
    return { value, complete: !raw.partial }
  })
}
