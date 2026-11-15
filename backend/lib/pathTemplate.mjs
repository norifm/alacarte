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

// amdp's own "01. Title" stem, which the historical layout keeps as is
// (qobuz and language renames included).
export function isLegacyFileStem(stem) {
  return /^\d{1,3}\.\s/.test(String(stem || ''))
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// The file pattern an existing name was written with, worked out from the
// track's own tags: "03 - GORO" with track 3 and title GORO is
// "$track - $title". Null when the tags cannot explain the name, so a
// pattern is never guessed that would not reproduce the file.
export function inferFilePattern(stem, vars) {
  const values = valuesFrom(vars)
  const name = String(stem || '')
  if (!name || name.includes('$')) return null
  // Longest values first, so a title holding the album or a number is
  // taken whole before its parts.
  const order = ['title', 'album', 'artist', 'year', 'track', 'disc']
    .filter((k) => values[k])
    .sort((a, b) => values[b].length - values[a].length)
  const slots = []
  let pending = name
  for (const key of order) {
    const value = values[key]
    const numeric = key === 'track' || key === 'disc' || key === 'year'
    const re = new RegExp(numeric ? `(?<!\\d)${escapeRegExp(value)}(?!\\d)` : escapeRegExp(value), 'i')
    const m = re.exec(pending)
    if (!m) continue
    slots.push(key)
    pending = `${pending.slice(0, m.index)}\u0001${slots.length - 1}\u0001${pending.slice(m.index + m[0].length)}`
  }
  if (!slots.includes('title') && !slots.includes('track')) return null
  const pattern = pending.replace(/\u0001(\d+)\u0001/g, (_, i) => `$${slots[Number(i)]}`)
  return renderFileStem(pattern, vars) === name ? pattern : null
}

// Placeholders that survive renderSegment's cleanup, so a rendered pattern
// shows where each value went.
const PLACEHOLDER = {
  artist: 'Qzartistzq',
  album: 'Qzalbumzq',
  title: 'Qztitlezq',
  year: '9173',
  track: '83',
  disc: '79',
}
const CAPTURE = {
  artist: '.+?',
  album: '.+?',
  title: '.+?',
  year: '\\d{4}',
  track: '\\d{1,3}',
  disc: '\\d{1,3}',
}
const OPTIONAL = ['year', 'track', 'disc']

// The inverse of renderSegment: the values a name was rendered from, or
// null when the pattern cannot have produced it. Year, track and disc may
// be missing, as renderSegment drops them with their separators; readings
// with more values are tried first.
export function matchSegment(pattern, name) {
  const target = String(name ?? '')
  if (!target) return null
  const tokens = [...new Set(tokenNames(pattern))].filter((t) => KNOWN.has(t))
  const optional = tokens.filter((t) => OPTIONAL.includes(t))
  const subsets = []
  for (let mask = (1 << optional.length) - 1; mask >= 0; mask -= 1) {
    subsets.push(optional.filter((_, i) => mask & (1 << i)))
  }
  subsets.sort((a, b) => b.length - a.length)
  for (const present of subsets) {
    const vars = {}
    for (const t of tokens) if (!OPTIONAL.includes(t) || present.includes(t)) vars[t] = PLACEHOLDER[t]
    const rendered = renderSegment(pattern, vars)
    if (!rendered) continue
    const used = new Set()
    let source = escapeRegExp(rendered)
    for (const t of tokens) {
      const ph = escapeRegExp(PLACEHOLDER[t])
      source = source.replace(new RegExp(ph, 'g'), () => {
        if (used.has(t)) return `\\k<${t}>`
        used.add(t)
        return `(?<${t}>${CAPTURE[t]})`
      })
    }
    const m = new RegExp(`^${source}$`).exec(target)
    if (m) return { ...m.groups }
  }
  return null
}
