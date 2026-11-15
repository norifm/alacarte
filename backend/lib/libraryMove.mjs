import fsp from 'node:fs/promises'
import path from 'node:path'

import { emitEvent } from './eventBus.mjs'
import { readTrackTags } from './audioTags.mjs'
import { fitFileName, sanitizeSegment } from './libraryMatchKey.mjs'
import { invalidateLibraryCache, scanLibrary } from './libraryIndex.mjs'
import { getNavidromeVersion, navidromeMoveRisk, triggerNavidromeScan } from './navidromeApi.mjs'
import {
  isLegacyFileStem,
  matchSegment,
  parsePathTemplate,
  renderFileStem,
  renderSegment,
} from './pathTemplate.mjs'
import { holdQueue, isQueueIdle, releaseQueue } from './queue.mjs'
import { readSettings, writeSettings } from './settingsStore.mjs'

// Moves the albums already in the library to a new folder scheme (or
// primary-artist setting), the way the tag and lyrics backfills run:
// start/status/stop, progress events, one run at a time.
//
// The whole plan is written to a journal before the first rename, and
// every finished step is appended to a log, so a crash resumes where it
// stopped and Undo can put each file back in reverse order. Nothing is
// overwritten: an album whose new folder or file names are taken is skipped
// and listed. Only folders the move left empty are removed.

const PROGRESS_MIN_INTERVAL_MS = 400
const QUEUE_IDLE_POLL_MS = 500
const SKIPPED_LIST_MAX = 50
const HOLD_REASON = 'library-move'

const AUDIO_RE = /\.(flac|m4a|mp3|opus|ogg)$/i
const SIDECAR_EXTS = ['.lrc', '.ttml', '.txt']

function musicRoot() {
  return process.env.AMDL_MUSIC_PATH || '/music'
}

function journalDir() {
  return path.join(process.env.AMDL_CONFIG_DIR || '/config', 'library-move')
}

const JOURNAL = () => path.join(journalDir(), 'journal.json')
const DONE_LOG = () => path.join(journalDir(), 'done.log')
const UNDONE_LOG = () => path.join(journalDir(), 'undone.log')
const PLAYLIST_BACKUPS = () => path.join(journalDir(), 'playlists')

// Sample albums for the confirmation dialog: one artist, and a collab.
export const SAMPLE_ALBUMS = [
  {
    kind: 'album',
    artistDir: 'Daft Punk',
    albumDir: 'Random Access Memories',
    tags: { albumArtist: 'Daft Punk', albumArtists: [], album: 'Random Access Memories', year: '2013' },
    file: { name: '08. Get Lucky.flac', tags: { title: 'Get Lucky', track: 8, disc: 1 } },
  },
  {
    kind: 'collab',
    artistDir: 'Anyma & Joji',
    albumDir: 'Beautiful - Single',
    tags: { albumArtist: 'Anyma & Joji', albumArtists: ['Anyma', 'Joji'], album: 'Beautiful - Single', year: '2024' },
    file: { name: '01. Beautiful.flac', tags: { title: 'Beautiful', track: 1, disc: 1 } },
  },
]

const state = {
  running: false,
  mode: 'move', // move | undo
  phase: 'idle', // idle | planning | waiting | moving | playlists | scanning | done
  total: 0,
  scanned: 0,
  moved: 0,
  inPlace: 0,
  skipped: 0,
  failed: 0,
  playlistsUpdated: 0,
  skippedItems: [],
  current: null,
  startedAt: null,
  finishedAt: null,
  stopRequested: false,
  error: null,
  canUndo: false,
}

let lastEmitAt = 0
let runPromise = null

function status() {
  const { skippedItems, ...rest } = state
  return { ...rest, skippedItems: skippedItems.slice(0, SKIPPED_LIST_MAX) }
}

export function getLibraryMoveStatus() {
  return status()
}

export function isLibraryMoveRunning() {
  return state.running
}

function emit(force = false) {
  const now = Date.now()
  if (!force && now - lastEmitAt < PROGRESS_MIN_INTERVAL_MS) return
  lastEmitAt = now
  emitEvent('library.move.progress', { ...status(), done: !state.running })
}

export function stopLibraryMove() {
  if (!state.running) return { ok: false, running: false }
  state.stopRequested = true
  emit(true)
  return { ok: true, running: true }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const posix = (p) => p.split(path.sep).join('/')
const rel = (abs) => posix(path.relative(musicRoot(), abs))
const abs = (r) => path.join(musicRoot(), ...String(r).split('/'))

async function statSafe(p) {
  return fsp.lstat(p).catch(() => null)
}

function sameFile(a, b) {
  return Boolean(a && b && a.ino === b.ino && a.dev === b.dev)
}

// Case-insensitive filesystems (macOS, Windows shares) report a name in
// another case as the same file. Checked against existing entries, so the
// dry run needs no write access.
async function probeCaseInsensitive(root) {
  const entries = await fsp.readdir(root).catch(() => [])
  const sample = entries.find((n) => n.toLowerCase() !== n.toUpperCase())
  if (!sample) return false
  const swapped = [...sample].map((c) => (c === c.toLowerCase() ? c.toUpperCase() : c.toLowerCase())).join('')
  if (swapped === sample) return false
  return sameFile(await statSafe(path.join(root, sample)), await statSafe(path.join(root, swapped)))
}

function nameKey(name, caseInsensitive) {
  const n = String(name).normalize('NFC')
  return caseInsensitive ? n.toLowerCase() : n
}

function sameName(a, b) {
  if (!a || !b) return false
  return sanitizeSegment(a).normalize('NFC').toLowerCase() === sanitizeSegment(b).normalize('NFC').toLowerCase()
}

const SUFFIX_RE = /\s*\((FLAC|ALAC|Atmos|AAC)\)$/i
const TRAILING_YEAR_RE = /\s*\((\d{4})\)\s*$/

// A collab spelled as one artist: "A & B", "A x B", "A and B".
// A comma is not enough: "Tyler, The Creator" is one artist, and the
// collabs in this library that use a comma also use "&".
function looksCombined(name) {
  return /\s&\s|\sx\s|\sand\s/i.test(String(name || ''))
}

// ---------------------------------------------------------------------------
// Planning

// Where one album folder goes under `to`, given what it is under `from`.
// Returns { artistName, albumName, files: [{ from, to }] } or { skip: reason }.
// Names the old scheme produced are read back (matchSegment), so moving
// twice does not stack decorations; a name a scheme did not produce (a hand
// rename, a language-mode title, a qobuz name) is kept as the value.
export function targetFor(album, from, to) {
  const { artistDir, albumDir, tags = {} } = album
  const suffix = SUFFIX_RE.exec(albumDir)?.[0] || ''
  const base = suffix ? albumDir.slice(0, -suffix.length) : albumDir

  const fromArtist = matchSegment(from.layout.artist, artistDir)?.artist || artistDir
  const fromAlbum = matchSegment(from.layout.album, base)
  let albumValue = fromAlbum?.album || base
  let year = tags.year || fromAlbum?.year || null
  // Today's folders sometimes end in " (2013)" even though the scheme has
  // no $year. Adopting $album ($year) would otherwise stack a second year.
  if (!/\$year\b/i.test(from.layout.album) && /\$year\b/i.test(to.layout.album)) {
    const trailing = TRAILING_YEAR_RE.exec(albumValue)
    if (trailing && (!year || trailing[1] === String(year))) {
      const stripped = albumValue.slice(0, trailing.index).trim()
      if (stripped) albumValue = stripped
      year = year || trailing[1]
    }
  }
  year = year || TRAILING_YEAR_RE.exec(base)?.[1] || null

  // The primary artist folder is the first ALBUMARTISTS credit of an album
  // filed under the full credit; switching it off files it back under the
  // full credit. Untagged collabs are skipped rather than guessed at.
  const credits = tags.albumArtists || []
  const display = tags.albumArtist || null
  let artist = fromArtist
  // Singles is one folder of loose tracks, so one file's credits cannot
  // decide a new artist for the whole folder.
  if (album.kind !== 'singles' && !tags.compilation && from.primary !== to.primary) {
    if (credits.length >= 2) {
      if (to.primary && sameName(fromArtist, display) && !sameName(display, credits[0])) artist = credits[0]
      if (!to.primary && sameName(fromArtist, credits[0]) && display && !sameName(display, credits[0])) artist = display
    } else if (to.primary && looksCombined(fromArtist)) {
      return { skip: 'noArtistCredits' }
    }
  }

  const vars = { artist, album: albumValue, year }
  const artistName =
    from.layout.artist === to.layout.artist && artist === fromArtist
      ? artistDir
      : sanitizeSegment(renderSegment(to.layout.artist, vars) || artist)
  const albumName =
    album.kind === 'singles' || from.layout.album === to.layout.album
      ? albumDir
      : `${sanitizeSegment(renderSegment(to.layout.album, vars) || albumValue)}${suffix}`

  const files = []
  if (from.layout.file !== to.layout.file && album.kind !== 'singles') {
    for (const file of album.files || []) {
      const ext = path.extname(file.name)
      const stem = file.name.slice(0, -ext.length)
      // The default layout keeps amdp's names; only files a scheme renamed
      // go back to "01. Title".
      if (!to.layout.customFile && isLegacyFileStem(stem)) continue
      const known = matchSegment(from.layout.file, stem)
      const legacy = isLegacyFileStem(stem) ? /^\d{1,3}\.\s(.+)$/.exec(stem)?.[1] : null
      const t = file.tags || {}
      // `$track. $title` with no track matches every file name. That reading
      // is only a fallback for an untagged file; it must not override tags
      // or get a guessed track number stuck on the front.
      const loose = Boolean(known && !known.track && !known.disc && !legacy)
      const fileVars = {
        artist,
        album: albumValue,
        year,
        track: t.track || known?.track || (loose ? null : /^\s*(\d{1,3})/.exec(stem)?.[1]) || null,
        disc: t.disc || known?.disc || null,
        title: legacy || (loose ? t.title || known.title : known?.title || t.title) || null,
      }
      if (!fileVars.title && !fileVars.track) return { skip: 'missingTags' }
      const newStem = renderFileStem(to.layout.file, fileVars, ext)
      if (!newStem) return { skip: 'missingTags' }
      const newName = fitFileName(`${newStem}${ext}`)
      if (newName !== file.name) files.push({ from: file.name, to: newName })
    }
  }
  return { artistName, albumName, files }
}

async function listAlbums(root) {
  const out = []
  const artists = await fsp.readdir(root, { withFileTypes: true }).catch(() => [])
  for (const a of artists) {
    if (!a.isDirectory() || a.name.startsWith('.') || a.name === 'Playlists') continue
    const children = await fsp.readdir(path.join(root, a.name), { withFileTypes: true }).catch(() => [])
    for (const c of children) {
      if (!c.isDirectory() || c.name.startsWith('.')) continue
      const dir = path.join(root, a.name, c.name)
      const entries = (await fsp.readdir(dir).catch(() => [])).sort()
      const audio = entries.filter((n) => AUDIO_RE.test(n))
      if (audio.length === 0) continue
      out.push({
        kind: c.name.toLowerCase() === 'singles' ? 'singles' : 'album',
        artistDir: a.name,
        albumDir: c.name,
        dir,
        entries,
        audio,
      })
    }
  }
  out.sort((x, y) => (x.dir < y.dir ? -1 : x.dir > y.dir ? 1 : 0))
  return out
}

function settingsLayout(s) {
  return { layout: parsePathTemplate(s?.pathTemplate), primary: Boolean(s?.primaryAlbumArtist) }
}

function skip(plan, item, reason) {
  plan.skipped.push({ path: rel(item.dir), reason })
}

// Works out every album's new place without touching the disk. The same
// plan backs the dry run in the confirmation dialog and the real move.
export async function planLibraryMove({ from, to, root = musicRoot() } = {}) {
  const fromL = settingsLayout(from)
  const toL = settingsLayout(to)
  const caseInsensitive = await probeCaseInsensitive(root)
  const plan = { albums: 0, items: [], inPlace: 0, skipped: [], caseInsensitive }
  const albums = await listAlbums(root)
  plan.albums = albums.length
  if (fromL.layout.stored === toL.layout.stored && fromL.primary === toL.primary) {
    plan.inPlace = albums.length
    return plan
  }
  const needFileTags = fromL.layout.file !== toL.layout.file

  // Existing artist folders, so a new artist folder reuses one that only
  // differs in case (like downloads do).
  const artistDirs = new Map()
  for (const e of await fsp.readdir(root, { withFileTypes: true }).catch(() => [])) {
    if (e.isDirectory() && !e.name.startsWith('.')) artistDirs.set(e.name.toLowerCase(), e.name)
  }

  const candidates = []
  for (const album of albums) {
    const first = await readTrackTags(path.join(album.dir, album.audio[0]))
    const files = []
    if (needFileTags) {
      for (const name of album.audio) {
        files.push({ name, tags: name === album.audio[0] ? first : await readTrackTags(path.join(album.dir, name)) })
      }
    }
    const target = targetFor({ ...album, tags: first, files }, fromL, toL)
    if (target.skip) {
      skip(plan, album, target.skip)
      continue
    }
    // Like downloads, an artist folder that only differs in case is reused.
    const known = artistDirs.get(target.artistName.toLowerCase())
    const artistName = known || target.artistName
    const createParent = !known
    if (!known) artistDirs.set(artistName.toLowerCase(), artistName)
    const destDir = path.join(root, artistName, target.albumName)
    candidates.push({ album, destDir, files: target.files, createParent })
  }

  // Two albums that would share a folder both stay where they are.
  const byDest = new Map()
  for (const c of candidates) {
    const key = nameKey(c.destDir, caseInsensitive)
    byDest.set(key, (byDest.get(key) || 0) + 1)
  }

  for (const c of candidates) {
    const { album, destDir, files, createParent } = c
    const moving = destDir !== album.dir
    if (!moving && files.length === 0) {
      plan.inPlace += 1
      continue
    }
    if (moving && byDest.get(nameKey(destDir, caseInsensitive)) > 1) {
      skip(plan, album, 'collision')
      continue
    }
    if (moving) {
      const there = await statSafe(destDir)
      if (there && !sameFile(there, await statSafe(album.dir))) {
        skip(plan, album, 'exists')
        continue
      }
      const parent = await statSafe(path.dirname(destDir))
      if (parent && !parent.isDirectory()) {
        skip(plan, album, 'exists')
        continue
      }
    }
    const renames = sidecarRenames(album.entries, files, caseInsensitive)
    if (!renames) {
      skip(plan, album, 'fileCollision')
      continue
    }
    plan.items.push({
      from: rel(album.dir),
      to: rel(destDir),
      files: renames,
      createParent: moving && createParent,
    })
  }
  return plan
}

// Audio renames plus their .lrc/.ttml/.txt sidecars, or null when a new
// name is taken by a file that stays or by another file of the album.
function sidecarRenames(entries, files, caseInsensitive) {
  const out = []
  const lowerEntries = new Map(entries.map((e) => [e.toLowerCase(), e]))
  for (const { from, to } of files) {
    out.push({ from, to })
    const fromStem = from.slice(0, -path.extname(from).length)
    const toStem = to.slice(0, -path.extname(to).length)
    for (const ext of SIDECAR_EXTS) {
      const existing = lowerEntries.get(`${fromStem}${ext}`.toLowerCase())
      if (!existing || out.some((r) => r.from === existing)) continue
      out.push({ from: existing, to: `${toStem}${existing.slice(fromStem.length)}` })
    }
  }
  const leaving = new Set(out.map((r) => nameKey(r.from, caseInsensitive)))
  const staying = new Set(entries.map((e) => nameKey(e, caseInsensitive)).filter((k) => !leaving.has(k)))
  const targets = new Set()
  for (const r of out) {
    const key = nameKey(r.to, caseInsensitive)
    if (targets.has(key) || staying.has(key)) return null
    targets.add(key)
  }
  return out
}

// ---------------------------------------------------------------------------
// Journal

async function writeJsonAtomic(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  const fh = await fsp.open(tmp, 'w')
  try {
    await fh.writeFile(JSON.stringify(data))
    await fh.sync()
  } finally {
    await fh.close()
  }
  await fsp.rename(tmp, file)
}

export async function readJournal() {
  try {
    return JSON.parse(await fsp.readFile(JOURNAL(), 'utf8'))
  } catch {
    return null
  }
}

async function readLog(file) {
  const text = await fsp.readFile(file, 'utf8').catch(() => '')
  return new Set(text.split('\n').filter(Boolean).map(Number))
}

async function appendLog(file, i) {
  const fh = await fsp.open(file, 'a')
  try {
    await fh.write(`${i}\n`)
    await fh.datasync()
  } finally {
    await fh.close()
  }
}

// Steps for one album: create the artist folder if needed, rename the album
// folder (through a temporary name when only the case changes), then rename
// the files inside, through temporary names when they swap places.
function albumSteps(item, { caseInsensitive, createdDirs }) {
  const steps = []
  const destParent = path.posix.dirname(item.to)
  if (item.to !== item.from) {
    if (item.createParent && !createdDirs.has(destParent)) steps.push({ op: 'mkdir', path: destParent, album: item.from })
    createdDirs.add(destParent)
    if (item.from.toLowerCase() === item.to.toLowerCase()) {
      const via = `${item.from}.alacarte-move`
      steps.push({ op: 'rename', from: item.from, to: via, album: item.from })
      steps.push({ op: 'rename', from: via, to: item.to, album: item.from })
    } else {
      steps.push({ op: 'rename', from: item.from, to: item.to, album: item.from })
    }
  }
  const dir = item.to
  const sources = new Set(item.files.map((f) => nameKey(f.from, caseInsensitive)))
  const needsTemp = item.files.some(
    (f) => sources.has(nameKey(f.to, caseInsensitive)) || f.from.toLowerCase() === f.to.toLowerCase(),
  )
  if (needsTemp) {
    item.files.forEach((f, i) => steps.push({ op: 'rename', from: `${dir}/${f.from}`, to: `${dir}/.alacarte-move-${i}`, album: item.from }))
    item.files.forEach((f, i) => steps.push({ op: 'rename', from: `${dir}/.alacarte-move-${i}`, to: `${dir}/${f.to}`, album: item.from }))
  } else {
    for (const f of item.files) steps.push({ op: 'rename', from: `${dir}/${f.from}`, to: `${dir}/${f.to}`, album: item.from })
  }
  return steps
}

function stepsFor(plan) {
  const createdDirs = new Set()
  const steps = []
  for (const item of plan.items) steps.push(...albumSteps(item, { caseInsensitive: plan.caseInsensitive, createdDirs }))
  return steps
}

// One step, safe to run again after a crash: a rename that already
// happened (source gone, target there) counts as done. Never overwrites.
async function applyStep(step, { reverse = false } = {}) {
  if (step.op === 'mkdir') {
    if (reverse) {
      await fsp.rmdir(abs(step.path)).catch(() => {})
      return 'done'
    }
    const st = await statSafe(abs(step.path))
    if (st?.isDirectory()) {
      step.existed = true
      return 'existed'
    }
    if (st) return 'conflict'
    await fsp.mkdir(abs(step.path))
    return 'done'
  }
  if (step.op === 'rmdir') {
    if (reverse) {
      await fsp.mkdir(abs(step.path), { recursive: true }).catch(() => {})
      return 'done'
    }
    await fsp.rmdir(abs(step.path)).catch(() => {})
    return 'done'
  }
  const from = abs(reverse ? step.to : step.from)
  const to = abs(reverse ? step.from : step.to)
  const src = await statSafe(from)
  const dst = await statSafe(to)
  if (!src) return dst ? 'done' : 'missing'
  // On a case-insensitive filesystem a case-only rename sees itself as the
  // target; anything else already there is never replaced.
  if (dst && !sameFile(src, dst)) return 'conflict'
  if (dst && path.basename(from) === path.basename(to)) return 'done'
  await fsp.rename(from, to)
  return 'done'
}

// ---------------------------------------------------------------------------
// Playlists

// Where a file of a moved album is now, or null when it did not move (an
// album that failed or was stopped before its turn).
async function movedPath(items, relPath) {
  for (const item of items) {
    if (!relPath.startsWith(`${item.from}/`)) continue
    const name = relPath.slice(item.from.length + 1)
    if (name.includes('/')) return null
    const renamed = item.files.find((f) => f.from === name)?.to || name
    const next = `${item.to}/${renamed}`
    if (next === relPath) return null
    const there = await statSafe(abs(next))
    const old = await statSafe(abs(relPath))
    return there && !old ? next : null
  }
  return null
}

// Points Playlists/*.m3u8 at the moved files. The originals are kept in the
// journal folder so Undo restores them byte for byte.
async function rewritePlaylists(items) {
  const playlistsDir = path.join(musicRoot(), 'Playlists')
  let updated = 0
  const entries = await fsp.readdir(playlistsDir).catch(() => [])
  for (const name of entries) {
    if (!/\.m3u8$/i.test(name)) continue
    const file = path.join(playlistsDir, name)
    const text = await fsp.readFile(file, 'utf8').catch(() => null)
    if (text === null) continue
    let changed = false
    const lines = []
    for (const line of text.split('\n')) {
      const cr = line.endsWith('\r') ? '\r' : ''
      const raw = cr ? line.slice(0, -1) : line
      if (!raw.trim() || raw.startsWith('#')) {
        lines.push(line)
        continue
      }
      const r = posix(path.relative(musicRoot(), path.resolve(playlistsDir, raw)))
      const moved = r.startsWith('..') ? null : await movedPath(items, r)
      if (!moved) {
        lines.push(line)
        continue
      }
      changed = true
      lines.push(`${posix(path.relative(playlistsDir, abs(moved)))}${cr}`)
    }
    if (!changed) continue
    const backup = path.join(PLAYLIST_BACKUPS(), name)
    await fsp.mkdir(PLAYLIST_BACKUPS(), { recursive: true })
    if (!(await statSafe(backup))) await fsp.writeFile(backup, text)
    const tmp = path.join(playlistsDir, `.${name}.alacarte-move`)
    await fsp.writeFile(tmp, lines.join('\n'))
    await fsp.rename(tmp, file)
    updated += 1
  }
  return updated
}

async function restorePlaylists() {
  const dir = PLAYLIST_BACKUPS()
  const entries = await fsp.readdir(dir).catch(() => [])
  for (const name of entries) {
    const text = await fsp.readFile(path.join(dir, name), 'utf8')
    const file = path.join(musicRoot(), 'Playlists', name)
    const tmp = path.join(musicRoot(), 'Playlists', `.${name}.alacarte-move`)
    await fsp.writeFile(tmp, text)
    await fsp.rename(tmp, file)
  }
  await fsp.rm(dir, { recursive: true, force: true })
}

// ---------------------------------------------------------------------------
// Running

function resetState(mode) {
  Object.assign(state, {
    running: true,
    mode,
    phase: 'waiting',
    total: 0,
    scanned: 0,
    moved: 0,
    inPlace: 0,
    skipped: 0,
    failed: 0,
    playlistsUpdated: 0,
    skippedItems: [],
    current: null,
    startedAt: Date.now(),
    finishedAt: null,
    stopRequested: false,
    error: null,
    canUndo: false,
  })
}

async function waitForQueue() {
  state.phase = 'waiting'
  emit(true)
  while (!isQueueIdle()) {
    if (state.stopRequested) return false
    await sleep(QUEUE_IDLE_POLL_MS)
  }
  return true
}

// Empty folders the move left behind (old artist folders), bottom up.
async function removeEmptyParents(steps, done, journal) {
  const parents = new Set()
  for (const [i, step] of steps.entries()) {
    if (step.op === 'rename' && done.has(i) && step.album === step.from) parents.add(path.posix.dirname(step.from))
  }
  for (const p of [...parents].sort((a, b) => b.length - a.length)) {
    const entries = await fsp.readdir(abs(p)).catch(() => null)
    if (!entries || entries.length) continue
    const step = { op: 'rmdir', path: p }
    journal.steps.push(step)
    const i = journal.steps.length - 1
    await writeJsonAtomic(JOURNAL(), journal)
    await applyStep(step)
    await appendLog(DONE_LOG(), i)
    done.add(i)
  }
}

async function finishRescan() {
  state.phase = 'scanning'
  emit(true)
  invalidateLibraryCache()
  await scanLibrary().catch((err) => console.error('library rescan after move failed:', err.message))
  invalidateLibraryCache()
  await triggerNavidromeScan().catch(() => {})
}

async function runMove(journal) {
  holdQueue(HOLD_REASON)
  try {
    if (!(await waitForQueue())) {
      journal.state = 'stopped'
      await writeJsonAtomic(JOURNAL(), journal)
      return
    }
    state.phase = 'moving'
    const done = await readLog(DONE_LOG())
    const steps = journal.steps
    const albums = [...new Set(steps.map((s) => s.album).filter(Boolean))]
    state.total = albums.length
    state.inPlace = journal.inPlace || 0
    state.skipped = journal.skipped.length
    state.skippedItems = [...journal.skipped]
    emit(true)
    const failedAlbums = new Set(journal.failedAlbums || [])
    for (const album of albums) {
      if (state.stopRequested) break
      state.current = album
      let ok = !failedAlbums.has(album)
      for (const [i, step] of steps.entries()) {
        if (step.album !== album || done.has(i) || !ok) continue
        try {
          let result = await applyStep(step)
          if (result === 'existed') {
            // Made by someone else since the plan; Undo must leave it.
            await writeJsonAtomic(JOURNAL(), journal)
            result = 'done'
          }
          if (result !== 'done') throw new Error(result)
          await appendLog(DONE_LOG(), i)
          done.add(i)
        } catch (err) {
          // The rest of this album stays put; what moved is still undoable.
          ok = false
          failedAlbums.add(album)
          state.skippedItems.push({ path: album, reason: err.message === 'conflict' ? 'exists' : 'failed' })
          console.error(`library move: ${album} failed at step ${i}:`, err.message)
        }
      }
      if (ok) state.moved += 1
      else state.failed += 1
      state.scanned += 1
      emit()
    }
    journal.failedAlbums = [...failedAlbums]
    await removeEmptyParents(steps, done, journal)
    state.phase = 'playlists'
    emit(true)
    state.playlistsUpdated = await rewritePlaylists(journal.items)
    journal.state = state.stopRequested ? 'stopped' : 'done'
    journal.result = { moved: state.moved, failed: state.failed, playlistsUpdated: state.playlistsUpdated }
    await writeJsonAtomic(JOURNAL(), journal)
    await finishRescan()
  } finally {
    releaseQueue(HOLD_REASON)
  }
}

// Puts playlist entries back, then points anything still at its new path
// forward again. A stopped undo has some files home and some not.
async function syncPlaylistsAfterUndo(journal) {
  await restorePlaylists()
  return rewritePlaylists(journal.items)
}

async function runUndo(journal) {
  holdQueue(HOLD_REASON)
  try {
    if (!(await waitForQueue())) {
      journal.state = journal.undoFrom || 'done'
      await writeJsonAtomic(JOURNAL(), journal)
      return
    }
    state.phase = 'moving'
    const done = await readLog(DONE_LOG())
    const undone = await readLog(UNDONE_LOG())
    const steps = journal.steps
    const order = [...done].sort((a, b) => b - a)
    state.total = new Set(order.map((i) => steps[i]?.album).filter(Boolean)).size
    emit(true)
    const seen = new Set()
    let stopped = false
    for (const i of order) {
      if (state.stopRequested) {
        stopped = true
        break
      }
      const step = steps[i]
      if (!step || undone.has(i)) continue
      if (step.album && !seen.has(step.album)) {
        seen.add(step.album)
        state.current = step.album
        state.scanned += 1
        state.moved += 1
        emit()
      }
      // A folder that existed before the move is not the move's to remove.
      if (step.op === 'mkdir' && step.existed) {
        await appendLog(UNDONE_LOG(), i)
        continue
      }
      try {
        const result = await applyStep(step, { reverse: true })
        if (result === 'conflict') throw new Error('conflict')
      } catch (err) {
        state.failed += 1
        state.skippedItems.push({ path: step.to || step.path, reason: err.message === 'conflict' ? 'exists' : 'failed' })
      }
      await appendLog(UNDONE_LOG(), i)
    }
    state.phase = 'playlists'
    emit(true)
    state.playlistsUpdated = await syncPlaylistsAfterUndo(journal)
    if (stopped) {
      // Files put back stay back. Undo again finishes the rest.
      journal.state = journal.undoFrom || 'done'
      await writeJsonAtomic(JOURNAL(), journal)
      await finishRescan()
      return
    }
    await writeSettings({
      pathTemplate: journal.from.pathTemplate || '',
      primaryAlbumArtist: Boolean(journal.from.primaryAlbumArtist),
    })
    journal.state = 'undone'
    await writeJsonAtomic(JOURNAL(), journal)
    await finishRescan()
  } finally {
    releaseQueue(HOLD_REASON)
  }
}

function launch(mode, journal) {
  resetState(mode)
  emit(true)
  runPromise = (mode === 'undo' ? runUndo(journal) : runMove(journal))
    .catch((err) => {
      console.error(`library ${mode} failed:`, err)
      state.error = err.message || `library ${mode} failed`
    })
    .finally(async () => {
      const latest = await readJournal()
      state.running = false
      state.phase = 'done'
      state.current = null
      state.finishedAt = Date.now()
      state.canUndo = Boolean(latest && ['done', 'stopped', 'running'].includes(latest.state))
      emit(true)
    })
  return runPromise
}

function busyError(message, code) {
  const err = new Error(message)
  err.statusCode = 409
  err.code = code
  return err
}

// Saves the new scheme and moves the library to it. `isBusy` lets the
// caller refuse while a backfill walks the library.
export async function startLibraryMove({ pathTemplate, primaryAlbumArtist, isBusy = () => false } = {}) {
  if (state.running) throw busyError('a library move is already running', 'libraryMove.running')
  if (isBusy()) throw busyError('a library backfill is running', 'libraryMove.busy')
  const parsed = parsePathTemplate(pathTemplate)
  if (parsed.error) {
    const err = new Error('invalid folder scheme')
    err.statusCode = 400
    err.code = `pathTemplate.${parsed.error}`
    throw err
  }
  const current = await readSettings()
  const from = { pathTemplate: current.pathTemplate || '', primaryAlbumArtist: Boolean(current.primaryAlbumArtist) }
  const to = { pathTemplate: parsed.stored, primaryAlbumArtist: Boolean(primaryAlbumArtist) }
  resetState('move')
  state.phase = 'planning'
  emit(true)
  // Held before the plan so a download cannot land in a folder mid-scan.
  // The run keeps the hold and releases it when it finishes.
  holdQueue(HOLD_REASON)
  let started = false
  try {
    const plan = await planLibraryMove({ from, to })
    if (state.stopRequested) {
      state.running = false
      state.phase = 'done'
      state.finishedAt = Date.now()
      emit(true)
      return status()
    }
    const journal = {
      version: 1,
      createdAt: Date.now(),
      state: 'running',
      from,
      to,
      caseInsensitive: plan.caseInsensitive,
      albums: plan.albums,
      inPlace: plan.inPlace,
      skipped: plan.skipped,
      items: plan.items,
      steps: stepsFor(plan),
    }
    // A new move replaces the previous journal, and with it that Undo.
    // The journal is on disk before the setting changes and before any rename.
    await fsp.rm(journalDir(), { recursive: true, force: true })
    await writeJsonAtomic(JOURNAL(), journal)
    try {
      await writeSettings(to)
    } catch (err) {
      await fsp.rm(journalDir(), { recursive: true, force: true })
      throw err
    }
    started = true
    launch('move', journal)
    return status()
  } catch (err) {
    if (!started) {
      state.running = false
      state.phase = 'done'
      state.error = err.message
      emit(true)
    }
    throw err
  } finally {
    if (!started) releaseQueue(HOLD_REASON)
  }
}

export async function undoLibraryMove() {
  if (state.running) throw busyError('a library move is already running', 'libraryMove.running')
  const journal = await readJournal()
  if (!journal || !['done', 'stopped', 'running'].includes(journal.state)) {
    const err = new Error('nothing to undo')
    err.statusCode = 409
    err.code = 'libraryMove.nothingToUndo'
    throw err
  }
  journal.undoFrom = journal.state
  journal.state = 'undoing'
  await writeJsonAtomic(JOURNAL(), journal)
  launch('undo', journal)
  return status()
}

// Picks up a move or an undo that a restart interrupted.
export async function initLibraryMove() {
  const journal = await readJournal()
  if (!journal) return
  if (journal.state === 'running') {
    console.log('[library] resuming an interrupted library move')
    launch('move', journal)
  } else if (journal.state === 'undoing') {
    console.log('[library] resuming an interrupted undo of a library move')
    launch('undo', journal)
  } else {
    state.canUndo = ['done', 'stopped'].includes(journal.state)
    state.finishedAt = journal.result ? journal.createdAt : null
    if (journal.result) {
      state.moved = journal.result.moved || 0
      state.failed = journal.result.failed || 0
      state.playlistsUpdated = journal.result.playlistsUpdated || 0
      state.inPlace = journal.inPlace || 0
      state.skipped = journal.skipped?.length || 0
      state.skippedItems = journal.skipped || []
    }
  }
}

// For tests: resolves when the current run has finished.
export function waitForLibraryMove() {
  return runPromise || Promise.resolve()
}

// ---------------------------------------------------------------------------
// Dry run for the confirmation dialog

export async function previewLibraryMove({ pathTemplate, primaryAlbumArtist }) {
  const parsed = parsePathTemplate(pathTemplate)
  if (parsed.error) return { error: `pathTemplate.${parsed.error}` }
  const current = await readSettings()
  const from = { pathTemplate: current.pathTemplate || '', primaryAlbumArtist: Boolean(current.primaryAlbumArtist) }
  const to = { pathTemplate: parsed.stored, primaryAlbumArtist: Boolean(primaryAlbumArtist) }
  const legacy = settingsLayout({})
  const toL = settingsLayout(to)
  const samples = SAMPLE_ALBUMS.map((sample) => {
    const target = targetFor({ ...sample, files: [sample.file] }, legacy, toL)
    const fileName = target.files?.[0]?.to || sample.file.name
    return { kind: sample.kind, path: `${target.artistName}/${target.albumName}/${fileName}` }
  })
  const [plan, navidrome] = await Promise.all([planLibraryMove({ from, to }), getNavidromeVersion()])
  const risk = navidromeMoveRisk(navidrome.version)
  return {
    error: null,
    samples,
    albums: plan.albums,
    move: plan.items.length,
    inPlace: plan.inPlace,
    skipped: plan.skipped.length,
    skippedItems: plan.skipped.slice(0, 8),
    navidrome: {
      connected: navidrome.connected,
      version: navidrome.version,
      losesPlays: navidrome.connected && risk.losesPlays,
      // A develop build can answer the ping with a hash and no number.
      versionUnknown: navidrome.connected && risk.versionUnknown,
    },
  }
}

export const __test__ = { state, applyStep, stepsFor, probeCaseInsensitive, sidecarRenames }
