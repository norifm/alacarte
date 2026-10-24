import fsp from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'

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

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    proc.stderr.on('data', (d) => {
      stderr += d.toString()
    })
    proc.on('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(-500)}`))
    })
    proc.on('error', reject)
  })
}

async function embedLrcInM4a(m4aPath, lrcContent) {
  const tmpPath = `${m4aPath}.tmp.m4a`
  await runFfmpeg([
    '-y',
    '-i',
    m4aPath,
    '-c',
    'copy',
    '-metadata',
    `lyrics=${lrcContent}`,
    tmpPath,
  ])
  await fsp.rename(tmpPath, m4aPath)
}

/**
 * Ensures that any directory containing .ttml sidecars also contains the corresponding
 * .lrc sidecars (converted from TTML) and that any companion .m4a audio file has its
 * embedded lyrics tag set to standard LRC text rather than raw TTML XML.
 */
export async function syncDualLyricsInDir(dir) {
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      await syncDualLyricsInDir(fullPath)
    } else if (/\.ttml$/i.test(entry.name)) {
      const base = path.basename(entry.name, path.extname(entry.name))
      const lrcPath = path.join(dir, `${base}.lrc`)
      const lrcExists = await fsp.stat(lrcPath).then((s) => s.isFile()).catch(() => false)
      let lrcContent = ''
      if (!lrcExists) {
        const ttmlXml = await fsp.readFile(fullPath, 'utf8').catch(() => '')
        lrcContent = ttmlToLrc(ttmlXml)
        if (lrcContent) {
          await fsp.writeFile(lrcPath, lrcContent, 'utf8')
        }
      } else {
        lrcContent = await fsp.readFile(lrcPath, 'utf8').catch(() => '')
      }

      if (lrcContent) {
        const m4aPath = path.join(dir, `${base}.m4a`)
        const m4aExists = await fsp.stat(m4aPath).then((s) => s.isFile()).catch(() => false)
        if (m4aExists) {
          try {
            await embedLrcInM4a(m4aPath, lrcContent)
          } catch (err) {
            console.warn(`[lyrics] Failed to embed LRC in ${m4aPath}:`, err.message)
          }
        }
      }
    }
  }
}
