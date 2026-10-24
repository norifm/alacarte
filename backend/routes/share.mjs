// "Share" endpoint for iOS Shortcuts: takes an Apple Music link and starts the
// download right away. Mounted by routes/integration.mjs, so it sits behind
// the same Bearer-token check as the rest of /api/integration/v1.
//
//   POST /api/integration/v1/share   { "url": "https://music.apple.com/..." }
//
// Always answers with JSON that has a human-readable `message` (for the
// Shortcut's notification) and a machine-readable `status`:
//   queued | already_in_library | invalid_link | unsupported | error
import { parseAppleMusicUrl } from '../lib/appleMusicUrl.mjs'
import * as queue from '../lib/queue.mjs'

function label(job, fallback) {
  const title = job?.albumTitle
  const artist = job?.artist
  if (title && artist) return `${artist} – ${title}`
  return title || fallback
}

export function createShareHandler(deps = {}) {
  const enqueueAlbum = deps.enqueueAlbum || queue.enqueueAlbum
  const enqueueSong = deps.enqueueSong || queue.enqueueSong
  const enqueuePlaylist = deps.enqueuePlaylist || queue.enqueuePlaylist

  return async function shareHandler(req, res) {
    const raw = req.body?.url
    if (typeof raw !== 'string' || !raw.trim()) {
      return res.status(400).json({ status: 'invalid_link', message: 'Kein Link übergeben (Feld "url" fehlt).' })
    }
    const parsed = parseAppleMusicUrl(raw)
    if (!parsed) {
      return res.status(400).json({ status: 'invalid_link', message: 'Das ist kein Apple-Music-Link.' })
    }
    if (parsed.unsupported) {
      return res.status(400).json({ status: 'unsupported', message: parsed.message })
    }
    if (parsed.kind === 'artist') {
      return res.status(400).json({
        status: 'unsupported',
        message: 'Künstler-Links werden nicht heruntergeladen. Bitte ein Album, einen Titel oder eine Playlist teilen.',
      })
    }

    try {
      let job
      let what
      if (parsed.kind === 'album') {
        job = await enqueueAlbum({ albumId: parsed.id, storefront: parsed.storefront })
        what = 'Album'
      } else if (parsed.kind === 'song') {
        job = await enqueueSong({
          songId: parsed.id,
          albumId: parsed.albumId || null,
          storefront: parsed.storefront,
        })
        what = 'Titel'
      } else {
        job = await enqueuePlaylist({ playlistId: parsed.id, storefront: parsed.storefront })
        what = 'Playlist'
      }
      return res.status(202).json({
        status: 'queued',
        kind: parsed.kind,
        message: `${what} in der Warteschlange: ${label(job, parsed.id)}`,
        job,
      })
    } catch (err) {
      if (err?.code === 'ALREADY_IN_LIBRARY') {
        return res.status(409).json({ status: 'already_in_library', message: err.message || 'Schon in der Bibliothek.' })
      }
      if (err?.code === 'NOT_RELEASED') {
        return res.status(409).json({ status: 'error', message: err.message })
      }
      if (err?.code === 'NO_MEDIA_USER_TOKEN' || err?.statusCode === 412) {
        return res.status(412).json({ status: 'error', message: err.message })
      }
      console.error(`[share] ${parsed.kind} ${parsed.id} failed:`, err?.message)
      return res.status(500).json({ status: 'error', message: err?.message || 'Unbekannter Fehler' })
    }
  }
}
