import { stripTrailingYear } from './libraryMatchKey.mjs'

// Empty (and the historical Artist/Album/01. Title pattern) is not a custom
// scheme. Callers must keep the old write path in that case so an unset
// setting cannot move anyone's library.

const KNOWN = new Set(['artist', 'album', 'year', 'track', 'title', 'disc'])
const BAD_CHARS = /[<>:"/\\|?*\x00-\x1f]/g
const EMPTY = '\u0000'

function legacyLayout() {
  return {
    error: null,
    legacy: true,
    custom: false,
    customFile: false,
    stored: '',
    artist: '$artist',
    album: '$album',
    file: '$track. $title',
  }
}

function tokenNames(part) {
  return [...String(part).matchAll(/\$([A-Za-z]+)\b/g)].map((m) => m[1].toLowerCase())
}

// Validation failures are codes so the frontend can translate them. The
// English text is only for API callers and logs.
export const PATH_TEMPLATE_ERRORS = {
  tooLong: 'Folder scheme is too long',
  backslash: 'Folder scheme cannot contain backslashes',
  parts: 'Folder scheme needs artist/album/file',
  unknownToken: 'Folder scheme has an unknown $token',
  artistToken: 'Artist folder must include $artist',
  albumToken: 'Album folder must include $album',
  fileToken: 'File name must include $title or $track',
}

export function pathTemplateErrorMessage(code) {
  return PATH_TEMPLATE_ERRORS[code] || 'Invalid folder scheme'
}

export function parsePathTemplate(input) {
  const raw = String(input ?? '').trim()
  if (!raw) return legacyLayout()
  if (raw.length > 240) return { error: 'tooLong' }
  if (raw.includes('\\')) return { error: 'backslash' }
  const parts = raw.split('/').map((s) => s.trim())
  if (parts.length !== 3 || parts.some((p) => !p || p === '.' || p === '..')) {
    return { error: 'parts' }
  }
  for (const part of parts) {
    if (tokenNames(part).some((name) => !KNOWN.has(name))) {
      return { error: 'unknownToken' }
    }
  }
  const [artist, album, file] = parts
  if (!tokenNames(artist).includes('artist')) return { error: 'artistToken' }
  if (!tokenNames(album).includes('album')) return { error: 'albumToken' }
  const fileTokens = tokenNames(file)
  if (!fileTokens.includes('title') && !fileTokens.includes('track')) {
    return { error: 'fileToken' }
  }
  const legacyFile = /^\$track\s*\.\s*\$title$/i.test(file)
  const legacy =
    /^\$artist$/i.test(artist) &&
    /^\$album$/i.test(album) &&
    legacyFile
  if (legacy) return legacyLayout()
  return {
    error: null,
    legacy: false,
    custom: true,
    customFile: !legacyFile,
    stored: `${artist}/${album}/${file}`,
    artist,
    album,
    file,
  }
}

export function cleanToken(value) {
  return String(value || '')
    .replace(BAD_CHARS, '_')
    .replace(/\.+$/g, '')
    .trim()
}

export function yearToken(year) {
  const m = String(year ?? '').match(/\d{4}/)
  return m ? m[0] : ''
}

export function trackToken(track) {
  const m = String(track ?? '').match(/\d{1,3}/)
  if (!m) return ''
  const n = Number(m[0])
  if (!(n > 0)) return ''
  return String(n).padStart(2, '0')
}

export function discToken(disc) {
  const m = String(disc ?? '').match(/\d{1,3}/)
  if (!m) return ''
  const n = Number(m[0])
  if (!(n > 0)) return ''
  return String(n)
}

function valuesFrom(vars) {
  const v = vars || {}
  const album = cleanToken(stripTrailingYear(v.album) || v.album)
  return {
    artist: cleanToken(v.artist),
    album,
    year: yearToken(v.year),
    track: trackToken(v.track),
    title: cleanToken(v.title),
    disc: discToken(v.disc),
  }
}

// Missing values drop out with the separator glued to them, so
// `$album ($year)` with no year is `Album` and not `Album ()`.
export function renderSegment(pattern, vars) {
  const values = valuesFrom(vars)
  let s = String(pattern || '').replace(/\$([A-Za-z]+)\b/g, (_, name) => {
    const value = values[name.toLowerCase()]
    return value ? value : EMPTY
  })
  s = s.replace(new RegExp(`${EMPTY}[\\s.\\-]*|[\\s.\\-]*${EMPTY}`, 'g'), '')
  s = s.replace(/\(\s*\)|\[\s*\]/g, '')
  s = s.replace(/\s{2,}/g, ' ')
  s = s.replace(/^[\s.\-]+|[\s.\-]+$/g, '')
  return s.trim()
}

export function renderFileStem(pattern, vars, ext = '') {
  let stem = renderSegment(pattern, vars)
  const dotExt = !ext ? '' : ext.startsWith('.') ? ext : `.${ext}`
  if (dotExt && stem.toLowerCase().endsWith(dotExt.toLowerCase())) {
    stem = stem.slice(0, -dotExt.length).trim()
  }
  if (!stem || stem === '.' || stem === '..' || /[\\/]/.test(stem)) return ''
  return stem
}

// Folder name for a collab. Null means "keep the combined artist", which is
// also the answer for compilations and for a single credited artist.
export function primaryFolderArtist(meta, enabled) {
  if (!enabled || !meta || meta.isCompilation) return null
  const names = []
  for (const artist of meta.artists || []) {
    const name = artist?.name?.trim()
    if (name) names.push(name)
  }
  if (names.length < 2) return null
  const combined = String(meta.artistName || '').trim()
  if (!combined || names[0].toLowerCase() === combined.toLowerCase()) return null
  return names[0]
}
