import fsp from 'node:fs/promises'
import path from 'node:path'

import { emitEvent } from './eventBus.mjs'
import {
  normalizeIsrc,
  normalizeUpc,
  readAudioIdentityTags,
  readFlacComments,
  readTrackTags,
  writeAlbumArtistTag,
  writeFlacComments,
} from './audioTags.mjs'
import { readSettings } from './settingsStore.mjs'
import { getAlbumsByUpc, getSongsByIsrc } from './appleApi.mjs'
import { triggerNavidromeScan } from './navidromeApi.mjs'
import { withAppleRetry } from './appleWait.mjs'

const MUSIC_ROOT = process.env.AMDL_MUSIC_PATH || '/music'
const BATCH = 25
const REQUEST_DELAY_MS = 250
const PROGRESS_MIN_INTERVAL_MS = 400

// amdp tags a multi-artist song with one display string ("A & B"), which
// Navidrome turns into a fake combined artist. Apple lists each artist and
// composer separately, so those names go into repeated ARTISTS / COMPOSER /
// ALBUMARTISTS (and PERFORMER) fields; ARTIST keeps the display string, and
// ALBUMARTIST does too by default (changing it gives albums new Navidrome ids).
// When primaryAlbumArtist is enabled, ALBUMARTIST is set to the first album
// artist for non-compilation collabs while the combined display string is kept
// in ALBUMARTIST_CREDIT so turning the option off can restore it.

const defaultDeps = {
  getSongsByIsrc,
  getAlbumsByUpc,
  readSettings,
  triggerNavidromeScan,
  delayMs: REQUEST_DELAY_MS,
  now: () => Date.now(),
}

const sleep = (ms) => (ms ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve())

const names = (rel) => (rel?.data || []).map((a) => a.attributes?.name?.trim()).filter(Boolean)

function sameList(a = [], b = []) {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

function splitList(values) {
  const out = []
  for (const v of values || []) {
    for (const part of String(v).split(';')) {
      const name = part.trim()
      if (name && !out.includes(name)) out.push(name)
    }
  }
  return out
}

function isCompilationTags(current, isCompilation = false) {
  if (isCompilation) return true
  const raw = current?.COMPILATION?.[0]?.trim() || ''
  return raw === '1' || /^true$/i.test(raw)
}

// Only fields with more than one name are written; a single name already
// links fine through ARTIST / COMPOSER / ALBUMARTIST.
export function creditFields(
  current,
  { artists, composers, albumArtists, albumArtistName = null, isCompilation = false, primaryAlbumArtist = false },
) {
  const fields = {}
  if (artists?.length > 1 && !sameList(current.ARTISTS, artists)) fields.ARTISTS = artists
  // amdp also copies the display string into PERFORMER; real performer
  // credits look different and are left alone.
  const display = current.ARTIST?.[0]
  if (artists?.length > 1 && display && sameList(current.PERFORMER, [display])) fields.PERFORMER = artists
  if (composers?.length > 1 && !sameList(current.COMPOSER, composers)) fields.COMPOSER = composers
  if (albumArtists?.length > 1 && !sameList(current.ALBUMARTISTS, albumArtists)) {
    fields.ALBUMARTISTS = albumArtists
  }

  const currentAlbumArtist =
    current.ALBUMARTIST?.[0]?.trim() ||
    current.ALBUM_ARTIST?.[0]?.trim() ||
    current['ALBUM ARTIST']?.[0]?.trim() ||
    ''
  const currentCredit = current.ALBUMARTIST_CREDIT?.[0]?.trim() || ''
  if (primaryAlbumArtist) {
    if (!isCompilationTags(current, isCompilation) && albumArtists?.length > 1) {
      const primary = albumArtists[0]
      const hasAlias = Boolean(current.ALBUM_ARTIST?.length || current['ALBUM ARTIST']?.length)
      if (currentAlbumArtist !== primary || hasAlias) {
        fields.ALBUMARTIST = [primary]
        if (current.ALBUM_ARTIST?.length) fields.ALBUM_ARTIST = []
        if (current['ALBUM ARTIST']?.length) fields['ALBUM ARTIST'] = []
        const credit =
          currentCredit ||
          (currentAlbumArtist && currentAlbumArtist.toLowerCase() !== primary.toLowerCase() ? currentAlbumArtist : null) ||
          (albumArtistName && albumArtistName.toLowerCase() !== primary.toLowerCase() ? albumArtistName : null)
        if (credit && currentCredit !== credit) fields.ALBUMARTIST_CREDIT = [credit]
      }
    }
  } else if (currentCredit) {
    if (currentAlbumArtist !== currentCredit) fields.ALBUMARTIST = [currentCredit]
    if (current.ALBUM_ARTIST?.length) fields.ALBUM_ARTIST = []
    if (current['ALBUM ARTIST']?.length) fields['ALBUM ARTIST'] = []
    fields.ALBUMARTIST_CREDIT = []
  }

  return fields
}

async function lookupBatch(items, { storefront, language, deps, retry = (fn) => fn() }) {
  const isrcs = [...new Set(items.map((i) => i.isrc).filter(Boolean))]
  const upcs = [...new Set(items.map((i) => i.upc).filter(Boolean))]
  const songs = new Map()
  const albums = new Map()
  if (isrcs.length) {
    const json = await retry(() => deps.getSongsByIsrc({ storefront, isrcs, language, include: 'artists,composers' }))
    for (const s of json?.data || []) {
      const isrc = normalizeIsrc(s.attributes?.isrc)
      if (isrc && !songs.has(isrc)) {
        songs.set(isrc, { artists: names(s.relationships?.artists), composers: names(s.relationships?.composers) })
      }
    }
    await sleep(deps.delayMs)
  }
  if (upcs.length) {
    const json = await retry(() => deps.getAlbumsByUpc({ storefront, upcs, language, include: 'artists' }))
    for (const a of json?.data || []) {
      const upc = normalizeUpc(a.attributes?.upc)
      if (upc && !albums.has(upc)) {
        albums.set(upc, {
          albumArtists: names(a.relationships?.artists),
          albumArtistName: a.attributes?.artistName?.trim() || null,
          isCompilation: Boolean(a.attributes?.isCompilation),
        })
      }
    }
    await sleep(deps.delayMs)
  }
  return { songs, albums }
}

async function collectFiles(target, out, { includeM4a = false } = {}) {
  const stat = await fsp.stat(target).catch(() => null)
  if (!stat) return
  if (stat.isFile()) {
    if (/\.flac$/i.test(target) || (includeM4a && /\.m4a$/i.test(target))) out.push(target)
    return
  }
  const entries = await fsp.readdir(target, { withFileTypes: true }).catch(() => [])
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    await collectFiles(path.join(target, e.name), out, { includeM4a })
  }
}

/**
 * Writes per-artist credits into the given FLAC files (or folders of them),
 * and aligns ALBUMARTIST on collab FLAC/M4A files when primaryAlbumArtist is on.
 * onFile(result) is called per file with one of: updated, unchanged,
 * noMatch, failed. Never throws for a single file.
 */
export async function creditArtists(
  targets,
  {
    deps = defaultDeps,
    shouldStop = () => false,
    onFile = () => {},
    onWait = null,
    albumArtists: withAlbumArtists = true,
    primaryAlbumArtist: primaryOverride = undefined,
  } = {},
) {
  const settings = await deps.readSettings()
  const storefront = settings.storefront || 'us'
  const language = settings.language || 'en-US'
  const usePrimary = primaryOverride === undefined ? Boolean(settings.primaryAlbumArtist) : Boolean(primaryOverride)
  const includeM4a = Boolean(usePrimary && withAlbumArtists)
  const files = []
  for (const t of targets) await collectFiles(t, files, { includeM4a })

  const items = []
  for (const file of files) {
    if (/\.m4a$/i.test(file)) {
      const tags = await readTrackTags(file)
      let upc = normalizeUpc(tags.upc)
      if (!upc) upc = normalizeUpc((await readAudioIdentityTags(file)).upc)
      if (!upc) {
        onFile({ file, result: 'noMatch' })
        continue
      }
      items.push({ file, format: 'm4a', tags, isrc: '', upc })
      continue
    }
    const current = await readFlacComments(file)
    if (!current) {
      onFile({ file, result: 'failed' })
      continue
    }
    const isrc = normalizeIsrc(current.ISRC?.[0])
    const upc = withAlbumArtists ? normalizeUpc(current.BARCODE?.[0] || current.UPC?.[0]) : ''
    if (!isrc && !upc) {
      const localAlbumArtists = withAlbumArtists ? splitList(current.ALBUMARTISTS) : undefined
      const localFields = creditFields(current, {
        albumArtists: localAlbumArtists,
        primaryAlbumArtist: usePrimary,
      })
      if (Object.keys(localFields).length > 0) {
        const ok = await writeFlacComments(file, localFields)
        onFile({ file, result: ok ? 'updated' : 'failed' })
      } else {
        onFile({ file, result: 'noMatch' })
      }
      continue
    }
    items.push({ file, format: 'flac', current, isrc, upc })
  }

  for (let i = 0; i < items.length && !shouldStop(); i += BATCH) {
    const batch = items.slice(i, i + BATCH)
    let found
    try {
      // Only long-running backfills (onWait given) wait out a rate limit; the
      // download hook stays fail-soft so a finished job is never held up.
      const retry = onWait ? (fn) => withAppleRetry(fn, { shouldStop, onWait }) : undefined
      found = await lookupBatch(batch, { storefront, language, deps, retry })
    } catch (err) {
      for (const item of batch) onFile({ file: item.file, result: 'failed', error: err.message })
      continue
    }
    for (const item of batch) {
      const album = found.albums.get(item.upc)
      if (item.format === 'm4a') {
        if (!album) {
          onFile({ file: item.file, result: 'noMatch' })
          continue
        }
        if (item.tags.compilation || album.isCompilation || album.albumArtists.length < 2) {
          onFile({ file: item.file, result: 'unchanged' })
          continue
        }
        const primary = album.albumArtists[0]
        if (item.tags.albumArtist && item.tags.albumArtist.toLowerCase() === primary.toLowerCase()) {
          onFile({ file: item.file, result: 'unchanged' })
          continue
        }
        const ok = await writeAlbumArtistTag(item.file, primary)
        onFile({ file: item.file, result: ok ? 'updated' : 'failed' })
        continue
      }
      const song = found.songs.get(item.isrc)
      const existingAlbumArtists = withAlbumArtists ? splitList(item.current.ALBUMARTISTS) : undefined
      const albumArtists = album?.albumArtists?.length ? album.albumArtists : existingAlbumArtists
      if (!song && !album) {
        const localFields = creditFields(item.current, {
          albumArtists: existingAlbumArtists,
          primaryAlbumArtist: usePrimary,
        })
        if (Object.keys(localFields).length > 0) {
          const ok = await writeFlacComments(item.file, localFields)
          onFile({ file: item.file, result: ok ? 'updated' : 'failed' })
        } else {
          onFile({ file: item.file, result: 'noMatch' })
        }
        continue
      }
      const fields = creditFields(item.current, {
        ...(song || {}),
        albumArtists,
        albumArtistName: album?.albumArtistName || null,
        isCompilation: album?.isCompilation || false,
        primaryAlbumArtist: usePrimary,
      })
      if (Object.keys(fields).length === 0) {
        onFile({ file: item.file, result: 'unchanged' })
        continue
      }
      const ok = await writeFlacComments(item.file, fields)
      onFile({ file: item.file, result: ok ? 'updated' : 'failed' })
    }
  }
  return files.length
}

// Download hook: fail-soft, a credit lookup must never fail a finished job.
export async function creditImportedFiles(targets, opts = {}) {
  try {
    await creditArtists(targets.filter(Boolean), opts)
  } catch (err) {
    console.error('artist credits failed:', err.message)
  }
}

const state = {
  running: false,
  waitingUntil: null,
  scanned: 0,
  total: 0,
  updated: 0,
  skipped: 0,
  noMatch: 0,
  failed: 0,
  current: null,
  startedAt: null,
  finishedAt: null,
  stopRequested: false,
  error: null,
}

let lastEmitAt = 0

function status() {
  const { running, scanned, total, updated, skipped, noMatch, failed, current, startedAt, finishedAt, stopRequested, error, waitingUntil } = state
  return { running, scanned, total, updated, skipped, noMatch, failed, current, startedAt, finishedAt, stopRequested, error, waitingUntil }
}

function emit(force = false) {
  const now = Date.now()
  if (!force && now - lastEmitAt < PROGRESS_MIN_INTERVAL_MS) return
  lastEmitAt = now
  emitEvent('artists.backfill.progress', { ...status(), done: !state.running })
}

export function getArtistBackfillStatus() {
  return status()
}

export function stopArtistBackfill() {
  if (!state.running) return { ok: false, running: false }
  state.stopRequested = true
  emit(true)
  return { ok: true, running: true }
}

export async function startArtistBackfill({ deps = defaultDeps } = {}) {
  if (state.running) {
    const err = new Error('an artist backfill is already running')
    err.statusCode = 409
    throw err
  }
  Object.assign(state, {
    running: true,
    scanned: 0,
    total: 0,
    updated: 0,
    skipped: 0,
    noMatch: 0,
    failed: 0,
    current: null,
    startedAt: deps.now(),
    finishedAt: null,
    stopRequested: false,
    error: null,
    waitingUntil: null,
  })
  emit(true)
  const counters = { updated: 'updated', unchanged: 'skipped', noMatch: 'noMatch', failed: 'failed' }
  ;(async () => {
    try {
      const settings = await deps.readSettings()
      const all = []
      await collectFiles(MUSIC_ROOT, all, { includeM4a: Boolean(settings.primaryAlbumArtist) })
      state.total = all.length
      emit(true)
      await creditArtists([MUSIC_ROOT], {
        deps,
        shouldStop: () => state.stopRequested,
        onWait: (until) => {
          state.waitingUntil = until
          emit(true)
        },
        onFile: ({ file, result, error }) => {
          state.scanned += 1
          state[counters[result]] += 1
          state.current = path.relative(MUSIC_ROOT, file)
          if (error) state.error = error
          emit()
        },
      })
    } catch (err) {
      state.error = err.message || 'artist backfill failed'
    } finally {
      state.running = false
      state.waitingUntil = null
      state.current = null
      state.finishedAt = deps.now()
      // a full scan so Navidrome drops the combined artists it built before
      if (state.updated > 0) deps.triggerNavidromeScan({ fullScan: true }).catch(() => {})
      emit(true)
    }
  })()
  return status()
}
