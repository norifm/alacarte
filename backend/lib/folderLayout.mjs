import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'

import {
  applyQobuzWriteNaming,
  fitFileName,
  getNameByteLimit,
  sanitizeSegment,
  setNameByteLimit,
} from './libraryMatchKey.mjs'
import { parsePathTemplate, renderSegment } from './pathTemplate.mjs'
import { applyVariantSuffix, groupOf } from './qualityGroups.mjs'

export { fitFileName, sanitizeSegment }

export function applyNamingConvention(name, convention) {
  if (convention !== 'qobuz') return name
  return applyQobuzWriteNaming(name)
}

export async function resolveArtistDir(musicRoot, desiredArtist) {
  const desired = sanitizeSegment(desiredArtist)
  try {
    const entries = await fsp.readdir(musicRoot, { withFileTypes: true })
    const lower = desired.toLowerCase()
    const existing = entries.find(
      (e) => e.isDirectory() && e.name.toLowerCase() === lower,
    )
    if (existing) return existing.name
  } catch {}
  return desired
}

export async function computeFinalDir(musicRoot, artist, album, _year) {
  const artistDir = await resolveArtistDir(musicRoot, artist)
  const albumSeg = sanitizeSegment(album)
  return path.join(musicRoot, artistDir, albumSeg)
}

// An album that is already on disk wins over the scheme, and the directory
// has to be a real artist/album folder inside the library. Anything else
// (a symlink out of the library, a file, a deeper path) is ignored.
async function existingAlbumDir(musicRoot, existingDir) {
  if (!existingDir) return null
  let root
  try {
    root = await fsp.realpath(musicRoot)
  } catch {
    return null
  }
  let real
  try {
    real = await fsp.realpath(existingDir)
  } catch {
    return null
  }
  if (real !== root && !real.startsWith(`${root}${path.sep}`)) return null
  const parts = path.relative(root, real).split(path.sep).filter(Boolean)
  if (parts.length !== 2) return null
  if (parts[0] === 'Playlists' || parts.some((p) => p.startsWith('.'))) return null
  const st = await fsp.stat(real).catch(() => null)
  if (!st?.isDirectory()) return null
  return real
}

// `layout` comes from parsePathTemplate. A missing or legacy layout is the
// historical Artist/Album directory, year and all, with no scheme applied.
export async function resolveLibraryDir(musicRoot, {
  artist,
  album,
  year = null,
  layout = null,
  variant = null,
  quality = null,
  existingDir = null,
} = {}) {
  const kept = await existingAlbumDir(musicRoot, existingDir)
  if (kept) return kept
  const parsed = typeof layout === 'string' ? parsePathTemplate(layout) : layout
  const useScheme = Boolean(parsed?.custom)
  const vars = { artist, album, year }
  const artistName = useScheme ? renderSegment(parsed.artist, vars) || artist : artist
  const albumName = useScheme ? renderSegment(parsed.album, vars) || album : album
  let dir = await computeFinalDir(musicRoot, artistName, albumName, year)
  if (variant) dir = applyVariantSuffix(dir, variant, quality)
  return dir
}

export async function ensureDir(p) {
  await fsp.mkdir(p, { recursive: true, mode: 0o775 })
}

/**
 * Longest file name, in bytes, that dir accepts: 255 on most filesystems,
 * about 143 on eCryptfs. Found by creating test files in a temporary folder
 * inside dir. Null when dir cannot be written.
 */
export async function probeNameByteLimit(dir) {
  let probeDir
  try {
    await ensureDir(dir)
    probeDir = await fsp.mkdtemp(path.join(dir, '.alacarte-name-probe-'))
  } catch {
    return null
  }
  const fits = async (bytes) => {
    const file = path.join(probeDir, 'a'.repeat(bytes))
    try {
      await fsp.writeFile(file, '')
      await fsp.rm(file, { force: true })
      return true
    } catch {
      return false
    }
  }
  try {
    if (!(await fits(16))) return null
    if (await fits(255)) return 255
    let lo = 16
    let hi = 255
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (await fits(mid)) lo = mid
      else hi = mid
    }
    return lo
  } finally {
    await fsp.rm(probeDir, { recursive: true, force: true }).catch(() => {})
  }
}

// Cuts every name alacarte writes to the tightest limit among dirs.
export async function detectNameByteLimit(dirs) {
  const limits = (await Promise.all(dirs.map(probeNameByteLimit))).filter(Boolean)
  if (limits.length) setNameByteLimit(Math.min(...limits))
  return getNameByteLimit()
}

/**
 * Fail fast when a download target cannot be written: walks up from finalDir
 * to the nearest existing ancestor and checks W_OK there. Catches legacy
 * root-owned artist folders (e.g. after a rootful -> rootless container
 * migration) before the download runs instead of after.
 */
export async function assertWritableTarget(finalDir) {
  let dir = path.resolve(finalDir)
  for (;;) {
    if (fs.existsSync(dir)) break
    const parent = path.dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  try {
    await fsp.access(dir, fs.constants.W_OK)
  } catch (err) {
    throw new Error(
      `music library folder is not writable: ${dir} (${err.code || err.message}). ` +
        'Fix the folder ownership so the container user can write into it (e.g. chown -R the folder inside the music library).',
    )
  }
}

// Rough per-track sizes for the free-space check. Hi-res lossless runs well
// above CD size, so these err high.
const TRACK_BYTES = { flac: 100, alac: 100, atmos: 80, aac: 12 }
const MIN_FREE_BYTES = 1024 ** 3

export function estimateJobBytes(trackCount, quality) {
  const mb = TRACK_BYTES[quality] ?? TRACK_BYTES.flac
  return Math.max(1, Number(trackCount) || 1) * mb * 1024 ** 2
}

function nearestExisting(target) {
  let dir = path.resolve(target)
  while (!fs.existsSync(dir) && path.dirname(dir) !== dir) dir = path.dirname(dir)
  return dir
}

function formatGb(bytes) {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

// Staging holds the download plus, when converting, the FLAC copy; the
// library needs one copy. On a shared disk the staging peak is what counts.
// Fail-soft when the platform cannot report free space.
export async function assertFreeSpace({ stagingRoot, musicRoot, bytes, stagingFactor = 1, statfs = fsp.statfs }) {
  const needs = new Map()
  for (const [target, amount] of [
    [stagingRoot, bytes * stagingFactor],
    [musicRoot, bytes],
  ]) {
    const dir = nearestExisting(target)
    let dev, free
    try {
      dev = (await fsp.stat(dir)).dev
      const st = await statfs(dir)
      free = Number(st.bavail) * Number(st.bsize)
    } catch {
      continue
    }
    const prev = needs.get(dev)
    if (!prev || amount > prev.amount) needs.set(dev, { dir: target, amount, free })
  }
  for (const { dir, amount, free } of needs.values()) {
    const required = amount + MIN_FREE_BYTES
    if (free < required) {
      const err = new Error(
        `not enough free space for ${dir}: ${formatGb(free)} free, about ${formatGb(required)} needed`,
      )
      err.code = 'NO_SPACE'
      throw err
    }
  }
}

export async function mergeMove(src, dest) {
  await ensureDir(dest)
  const entries = await fsp.readdir(src, { withFileTypes: true })
  for (const e of entries) {
    const from = path.join(src, e.name)
    const to = path.join(dest, e.isDirectory() ? e.name : fitFileName(e.name))
    if (e.isDirectory()) {
      await mergeMove(from, to)
    } else {
      try {
        await fsp.rename(from, to)
      } catch (err) {
        if (err.code === 'EXDEV') {
          await fsp.copyFile(from, to)
          await fsp.unlink(from)
        } else if (err.code === 'EEXIST') {
          await fsp.rm(to)
          await fsp.rename(from, to)
        } else {
          throw err
        }
      }
    }
  }
  try {
    await fsp.rmdir(src)
  } catch {}
}

export function pathExists(p) {
  return fs.existsSync(p)
}

const VERSION_MARKER = '.alacarte-version'

export function versionMarkerPath(finalDir) {
  return path.join(finalDir, VERSION_MARKER)
}

export async function writeVersionMarker(finalDir, quality, { ifMissing = false } = {}) {
  const marker = versionMarkerPath(finalDir)
  if (ifMissing && fs.existsSync(marker)) return
  await fsp.writeFile(marker, groupOf(quality), 'utf8')
}

export async function readVersionMarker(finalDir) {
  const raw = await fsp.readFile(versionMarkerPath(finalDir), 'utf8').catch(() => null)
  const trimmed = raw?.trim()
  return trimmed || null
}
