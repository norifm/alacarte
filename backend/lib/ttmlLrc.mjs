import fsp from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

function parseTtmlTime(value) {
  if (!value) return null
  const parts = String(value).replace(/s$/, '').split(':').map(Number)
  if (parts.some((n) => Number.isNaN(n))) return null
  return parts.reduce((acc, n) => acc * 60 + n, 0)
}

export function decodeEntities(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

// Same line format amdp writes: [mm:ss.cc]text, one line per <p>. Unsynced
// lyrics come out as plain lines.
export function ttmlToLrc(ttml) {
  const synced = !/itunes:timing="None"/.test(ttml)
  const out = []
  for (const m of String(ttml).matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/g)) {
    const text = decodeEntities(m[2].replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim()
    const begin = parseTtmlTime(/\bbegin="([^"]+)"/.exec(m[1])?.[1])
    if (!synced || begin == null) {
      out.push(text)
      continue
    }
    const cs = Math.floor(begin * 100)
    const mm = String(Math.floor(cs / 6000)).padStart(2, '0')
    const ss = String(Math.floor((cs % 6000) / 100)).padStart(2, '0')
    out.push(`[${mm}:${ss}.${String(cs % 100).padStart(2, '0')}]${text}`)
  }
  return out.length ? `${out.join('\n')}\n` : null
}

// MP4Box edits the tag in place. An ffmpeg remux drops the ISRC and UPC and
// fails on Atmos. In its tag file a line starting with a tag name opens that
// tag, so a space keeps such a lyric from overwriting the title, and a last line
// under 4 characters is dropped, so blank padding ends the file instead of a lyric.
async function embedLrcInM4a(m4aPath, lrc) {
  const tagsPath = `${m4aPath}.tags.txt`
  const body = lrc.trimEnd().replace(/^(?=[^\s=[]+=)/gm, ' ')
  await fsp.writeFile(tagsPath, `lyrics=${body}\n\n    `)
  try {
    await execFileAsync('MP4Box', ['-itags', tagsPath, m4aPath], { timeout: 60_000 })
  } finally {
    await fsp.rm(tagsPath, { force: true })
  }
}

// amdp embeds the file it saved, so next to a .ttml the audio carries raw XML
// that players can't show. This swaps it for LRC, which a FLAC conversion then
// copies along, and writes the .lrc sidecar too when asked. An existing .lrc is kept.
export async function syncTtmlLyricsInDir(dir, { writeLrc = false } = {}) {
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await syncTtmlLyricsInDir(fullPath, { writeLrc })
      continue
    }
    if (!/\.ttml$/i.test(entry.name)) continue
    const stem = fullPath.slice(0, -path.extname(fullPath).length)
    let lrc = await fsp.readFile(`${stem}.lrc`, 'utf8').catch(() => null)
    if (lrc == null) {
      lrc = ttmlToLrc(await fsp.readFile(fullPath, 'utf8').catch(() => ''))
      if (lrc && writeLrc) await fsp.writeFile(`${stem}.lrc`, lrc, 'utf8')
    }
    if (!lrc) continue
    const m4aPath = `${stem}.m4a`
    if (!(await fsp.stat(m4aPath).then((s) => s.isFile(), () => false))) continue
    try {
      await embedLrcInM4a(m4aPath, lrc)
    } catch (err) {
      console.warn(`[lyrics] Failed to embed LRC in ${m4aPath}:`, err.message)
    }
  }
}
