// Mirrors parsePathTemplate in backend/lib/pathTemplate.mjs so a bad folder
// scheme is flagged while it is typed. The backend still validates on save
// and answers with the same codes.

export type PathTemplateError =
  | 'tooLong'
  | 'backslash'
  | 'parts'
  | 'unknownToken'
  | 'artistToken'
  | 'albumToken'
  | 'fileToken'

const KNOWN = new Set(['artist', 'album', 'year', 'track', 'title', 'disc'])

function tokenNames(part: string): string[] {
  return [...part.matchAll(/\$([A-Za-z]+)\b/g)].map((m) => m[1].toLowerCase())
}

export function pathTemplateError(input: string): PathTemplateError | null {
  const raw = String(input ?? '').trim()
  if (!raw) return null
  if (raw.length > 240) return 'tooLong'
  if (raw.includes('\\')) return 'backslash'
  const parts = raw.split('/').map((s) => s.trim())
  if (parts.length !== 3 || parts.some((p) => !p || p === '.' || p === '..')) return 'parts'
  if (parts.some((part) => tokenNames(part).some((name) => !KNOWN.has(name)))) return 'unknownToken'
  const [artist, album, file] = parts
  if (!tokenNames(artist).includes('artist')) return 'artistToken'
  if (!tokenNames(album).includes('album')) return 'albumToken'
  const fileTokens = tokenNames(file)
  if (!fileTokens.includes('title') && !fileTokens.includes('track')) return 'fileToken'
  return null
}

// The backend answers a rejected scheme with code "pathTemplate.<error>".
export function pathTemplateErrorFromCode(code: unknown): PathTemplateError | null {
  const m = /^pathTemplate\.(\w+)$/.exec(String(code || ''))
  return (m?.[1] as PathTemplateError) || null
}
