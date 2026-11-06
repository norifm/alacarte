import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { pipeline } from 'node:stream/promises'

const execFileAsync = promisify(execFile)

/**
 * Normalize ISRC: uppercase, strip hyphens/spaces.
 */
export function normalizeIsrc(value) {
  if (!value) return ''
  return String(value).toUpperCase().replace(/[\s\-]/g, '')
}

/**
 * Normalize UPC/EAN/barcode to digits only.
 */
export function normalizeUpc(value) {
  if (!value) return ''
  return String(value).replace(/\D/g, '')
}

/**
 * Read ISRC / UPC / BARCODE from a FLAC Vorbis comment block, the comment
 * packet of an Ogg file, or the iTunes freeform atoms amdp writes into .m4a
 * files. Walks the FLAC
 * metadata block chain with seeks, so comment blocks after large PICTURE
 * blocks are found too (ffmpeg remuxes reorder blocks). Fail-soft.
 */
export async function readAudioIdentityTags(filePath) {
  const empty = { isrc: '', upc: '' }
  if (/\.m4a$/i.test(filePath)) return readMp4IdentityTags(filePath)
  if (/\.(opus|ogg)$/i.test(filePath)) return readOggIdentityTags(filePath)
  try {
    if (!/\.flac$/i.test(filePath)) return empty
    const fh = await fsp.open(filePath, 'r')
    try {
      const magic = Buffer.alloc(4)
      const { bytesRead: magicRead } = await fh.read(magic, 0, 4, 0)
      if (magicRead < 4 || magic.toString('ascii', 0, 4) !== 'fLaC') {
        return empty
      }
      let offset = 4
      for (let guard = 0; guard < 128; guard += 1) {
        const header = Buffer.alloc(4)
        const { bytesRead } = await fh.read(header, 0, 4, offset)
        if (bytesRead < 4) return empty
        const word = header.readUInt32BE(0)
        const isLast = (word & 0x80000000) !== 0
        const type = (word >>> 24) & 0x7f
        const length = word & 0xffffff
        offset += 4
        if (type === 4) {
          const block = Buffer.alloc(Math.min(length, 1024 * 1024))
          const { bytesRead: blockRead } = await fh.read(
            block,
            0,
            block.length,
            offset,
          )
          if (blockRead < Math.min(length, block.length)) return empty
          return extractVorbisIdentity(block.subarray(0, blockRead))
        }
        offset += length
        if (isLast) return empty
      }
      return empty
    } finally {
      await fh.close()
    }
  } catch {
    return empty
  }
}

const MAX_OGG_TAGS_BYTES = 32 * 1024 * 1024

// The comments are the second packet of an Ogg stream, in the same layout as a
// FLAC comment block. Embedded cover art spreads that packet over many pages
// and can sit before the ISRC, so the whole packet is put back together.
async function readOggIdentityTags(filePath) {
  const empty = { isrc: '', upc: '' }
  try {
    const fh = await fsp.open(filePath, 'r')
    try {
      const parts = []
      let size = 0
      let packet = 0
      let offset = 0
      while (size <= MAX_OGG_TAGS_BYTES) {
        const header = Buffer.alloc(27)
        const { bytesRead } = await fh.read(header, 0, 27, offset)
        if (bytesRead < 27 || header.toString('ascii', 0, 4) !== 'OggS') return empty
        const lacing = Buffer.alloc(header[26])
        await fh.read(lacing, 0, lacing.length, offset + 27)
        const body = Buffer.alloc(lacing.reduce((sum, n) => sum + n, 0))
        await fh.read(body, 0, body.length, offset + 27 + lacing.length)
        let pos = 0
        for (const lace of lacing) {
          if (packet === 1) {
            parts.push(body.subarray(pos, pos + lace))
            size += lace
          }
          pos += lace
          if (lace === 255) continue
          if (packet === 1) return parseOggComments(Buffer.concat(parts))
          packet += 1
        }
        offset += 27 + lacing.length + body.length
      }
      return empty
    } finally {
      await fh.close()
    }
  } catch {
    return empty
  }
}

function parseOggComments(packet) {
  if (packet.toString('latin1', 0, 8) === 'OpusTags') return extractVorbisIdentity(packet.subarray(8))
  if (packet.toString('latin1', 0, 7) === '\x03vorbis') return extractVorbisIdentity(packet.subarray(7))
  return { isrc: '', upc: '' }
}

const MAX_MOOV_BYTES = 32 * 1024 * 1024

// Top-level boxes are walked with seeks so a moov after a large mdat is
// found without reading the audio.
async function readMp4IdentityTags(filePath) {
  const empty = { isrc: '', upc: '' }
  let fh
  try {
    fh = await fsp.open(filePath, 'r')
    const { size: fileSize } = await fh.stat()
    const header = Buffer.alloc(16)
    let offset = 0
    for (let guard = 0; guard < 64 && offset + 8 <= fileSize; guard += 1) {
      await fh.read(header, 0, 16, offset)
      let size = header.readUInt32BE(0)
      const type = header.toString('latin1', 4, 8)
      let headerLen = 8
      if (size === 1) {
        size = Number(header.readBigUInt64BE(8))
        headerLen = 16
      } else if (size === 0) {
        size = fileSize - offset
      }
      if (size < headerLen) return empty
      if (type === 'moov') {
        if (size > MAX_MOOV_BYTES) return empty
        const moov = Buffer.alloc(size - headerLen)
        await fh.read(moov, 0, moov.length, offset + headerLen)
        return parseMp4MoovIdentity(moov)
      }
      offset += size
    }
    return empty
  } catch {
    return empty
  } finally {
    await fh?.close().catch(() => {})
  }
}

function* mp4Boxes(buf, start = 0, end = buf.length) {
  let o = start
  while (o + 8 <= end) {
    const size = buf.readUInt32BE(o)
    if (size < 8 || o + size > end) return
    yield { type: buf.toString('latin1', o + 4, o + 8), start: o + 8, end: o + size }
    o += size
  }
}

function findMp4Box(buf, start, end, type) {
  for (const box of mp4Boxes(buf, start, end)) if (box.type === type) return box
  return null
}

// moov > [udta >] meta (full box) > ilst > '----' { mean, name, data }
export function parseMp4MoovIdentity(moov) {
  const out = { isrc: '', upc: '' }
  const udta = findMp4Box(moov, 0, moov.length, 'udta')
  const meta =
    (udta && findMp4Box(moov, udta.start, udta.end, 'meta')) ||
    findMp4Box(moov, 0, moov.length, 'meta')
  if (!meta) return out
  const ilst = findMp4Box(moov, meta.start + 4, meta.end, 'ilst')
  if (!ilst) return out
  for (const item of mp4Boxes(moov, ilst.start, ilst.end)) {
    if (item.type !== '----') continue
    let name = ''
    let value = ''
    for (const child of mp4Boxes(moov, item.start, item.end)) {
      if (child.type === 'name') name = moov.toString('utf8', child.start + 4, child.end)
      if (child.type === 'data') value = moov.toString('utf8', child.start + 8, child.end)
    }
    const key = name.trim().toUpperCase()
    if (key === 'ISRC' && !out.isrc) out.isrc = normalizeIsrc(value)
    if ((key === 'UPC' || key === 'BARCODE') && !out.upc) out.upc = normalizeUpc(value)
  }
  return out
}

export function parseFlacIdentityTags(buf) {
  const empty = { isrc: '', upc: '' }
  if (!buf || buf.length < 8) return empty
  if (buf.toString('ascii', 0, 4) !== 'fLaC') return empty

  let offset = 4
  while (offset + 4 <= buf.length) {
    const header = buf.readUInt32BE(offset)
    const isLast = (header & 0x80000000) !== 0
    const type = (header >>> 24) & 0x7f
    const length = header & 0xffffff
    offset += 4
    if (offset + length > buf.length) break
    const block = buf.subarray(offset, offset + length)
    offset += length

    if (type === 4) {
      return extractVorbisIdentity(block)
    }
    if (isLast) break
  }
  return empty
}

function extractVorbisIdentity(block) {
  const empty = { isrc: '', upc: '' }
  try {
    if (block.length < 8) return empty
    let o = 0
    const vendorLen = block.readUInt32LE(o)
    o += 4
    if (o + vendorLen + 4 > block.length) return empty
    o += vendorLen
    const commentCount = block.readUInt32LE(o)
    o += 4

    let isrc = ''
    let upc = ''
    for (let i = 0; i < commentCount; i++) {
      if (o + 4 > block.length) break
      const len = block.readUInt32LE(o)
      o += 4
      if (o + len > block.length) break
      const raw = block.toString('utf8', o, o + len)
      o += len
      const eq = raw.indexOf('=')
      if (eq <= 0) continue
      const key = raw.slice(0, eq).toUpperCase()
      const val = raw.slice(eq + 1).trim()
      if (!val) continue
      if (key === 'ISRC' && !isrc) isrc = normalizeIsrc(val)
      else if ((key === 'UPC' || key === 'BARCODE') && !upc) upc = normalizeUpc(val)
    }
    return { isrc, upc }
  } catch {
    return empty
  }
}

/**
 * Build a minimal valid-ish FLAC header with STREAMINFO + VORBIS_COMMENT.
 * Enough for parseFlacIdentityTags; not a playable encode.
 */
export function buildMinimalFlacWithTags(tags = {}) {
  const streamInfo = Buffer.alloc(34, 0)
  // min/max block size
  streamInfo.writeUInt16BE(16, 0)
  streamInfo.writeUInt16BE(16, 2)

  const comments = []
  if (tags.isrc) comments.push(`ISRC=${tags.isrc}`)
  if (tags.upc) comments.push(`UPC=${tags.upc}`)
  if (tags.barcode) comments.push(`BARCODE=${tags.barcode}`)
  for (const [k, v] of Object.entries(tags.extra || {})) {
    comments.push(`${k}=${v}`)
  }

  const vendor = Buffer.from('alacarte', 'utf8')
  const commentParts = []
  for (const c of comments) {
    const body = Buffer.from(c, 'utf8')
    const len = Buffer.alloc(4)
    len.writeUInt32LE(body.length, 0)
    commentParts.push(len, body)
  }
  const vorbis = Buffer.concat([
    (() => {
      const b = Buffer.alloc(4)
      b.writeUInt32LE(vendor.length, 0)
      return b
    })(),
    vendor,
    (() => {
      const b = Buffer.alloc(4)
      b.writeUInt32LE(comments.length, 0)
      return b
    })(),
    ...commentParts,
  ])

  function metaHeader(type, length, isLast) {
    const h = Buffer.alloc(4)
    const lastBit = isLast ? 0x80 : 0x00
    h[0] = lastBit | (type & 0x7f)
    h[1] = (length >>> 16) & 0xff
    h[2] = (length >>> 8) & 0xff
    h[3] = length & 0xff
    return h
  }

  return Buffer.concat([
    Buffer.from('fLaC', 'ascii'),
    metaHeader(0, streamInfo.length, false),
    streamInfo,
    metaHeader(4, vorbis.length, true),
    vorbis,
  ])
}

/**
 * Build a minimal Opus stream with the tags in a comment packet, which `padding`
 * bytes of fake cover art push onto later pages. Enough for readAudioIdentityTags;
 * not a playable encode.
 */
export function buildMinimalOpusWithTags({ isrc, upc, padding = 0 } = {}) {
  const comments = []
  if (padding) comments.push(['METADATA_BLOCK_PICTURE', 'x'.repeat(padding)])
  if (isrc) comments.push(['ISRC', isrc])
  if (upc) comments.push(['BARCODE', upc])
  const tags = Buffer.concat([Buffer.from('OpusTags'), buildVorbisBlock({ vendor: 'test', comments })])
  const lacing = [...Array(Math.floor(tags.length / 255)).fill(255), tags.length % 255]
  const page = (lace, body) =>
    Buffer.concat([Buffer.from('OggS'), Buffer.alloc(22), Buffer.from([lace.length]), Buffer.from(lace), body])
  const head = Buffer.from('OpusHead')
  const pages = [page([head.length], head)]
  let pos = 0
  for (let i = 0; i < lacing.length; i += 255) {
    const lace = lacing.slice(i, i + 255)
    const size = lace.reduce((sum, n) => sum + n, 0)
    pages.push(page(lace, tags.subarray(pos, pos + size)))
    pos += size
  }
  return Buffer.concat(pages)
}

/** Sync walker mirroring readAudioIdentityTags for scripts and tests. */
export function readAudioIdentityTagsSync(filePath) {
  const empty = { isrc: '', upc: '' }
  try {
    if (!/\.flac$/i.test(filePath)) return empty
    const fd = fs.openSync(filePath, 'r')
    try {
      const magic = Buffer.alloc(4)
      if (fs.readSync(fd, magic, 0, 4, 0) < 4) return empty
      if (magic.toString('ascii', 0, 4) !== 'fLaC') return empty
      let offset = 4
      for (let guard = 0; guard < 128; guard += 1) {
        const header = Buffer.alloc(4)
        if (fs.readSync(fd, header, 0, 4, offset) < 4) return empty
        const word = header.readUInt32BE(0)
        const isLast = (word & 0x80000000) !== 0
        const type = (word >>> 24) & 0x7f
        const length = word & 0xffffff
        offset += 4
        if (type === 4) {
          const block = Buffer.alloc(Math.min(length, 1024 * 1024))
          const blockRead = fs.readSync(fd, block, 0, block.length, offset)
          if (blockRead < Math.min(length, block.length)) return empty
          return extractVorbisIdentity(block.subarray(0, blockRead))
        }
        offset += length
        if (isLast) return empty
      }
      return empty
    } finally {
      fs.closeSync(fd)
    }
  } catch {
    return empty
  }
}

/**
 * Write ISRC / BARCODE (and optional extra) vorbis comments into a FLAC via
 * an ffmpeg stream-copy remux (lossless, keeps all existing metadata).
 * Fail-soft: returns false on any problem and never touches the original
 * file on failure.
 *
 * `extra` is an arbitrary string-keyed map of additional Vorbis comment
 * fields to set — used by the Library Output language feature to stamp
 * ORIGINAL_TITLE / ORIGINAL_ALBUM / ORIGINAL_ARTIST (see queue.mjs). Vorbis
 * comments accept any field name, so this reuses the same identity-tag
 * remux instead of a separate write path.
 */
// Writes to one file run one after another: downloads and the tag backfill
// both stamp files, and a stamp remuxes through a fixed temp file name.
const stampQueues = new Map()

export function writeAudioIdentityTags(filePath, tags = {}) {
  const key = path.resolve(filePath)
  const previous = stampQueues.get(key) || Promise.resolve()
  const run = previous.catch(() => {}).then(() => stampIdentityTags(filePath, tags))
  stampQueues.set(key, run)
  const release = () => {
    if (stampQueues.get(key) === run) stampQueues.delete(key)
  }
  run.then(release, release)
  return run
}

async function stampIdentityTags(filePath, { isrc, upc, extra } = {}) {
  if (!/\.flac$/i.test(filePath)) return false
  const isrcNorm = normalizeIsrc(isrc)
  const upcNorm = normalizeUpc(upc)
  const extraEntries =
    extra && typeof extra === 'object'
      ? Object.entries(extra).filter(([, v]) => v != null && String(v).trim())
      : []
  if (!isrcNorm && !upcNorm && extraEntries.length === 0) return false
  const tmp = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.stamp-tmp.flac`,
  )
  const args = ['-y', '-nostdin', '-v', 'error', '-i', filePath, '-map_metadata', '0', '-c', 'copy']
  if (isrcNorm) args.push('-metadata', `ISRC=${isrcNorm}`)
  if (upcNorm) args.push('-metadata', `BARCODE=${upcNorm}`)
  for (const [key, value] of extraEntries) {
    args.push('-metadata', `${key}=${String(value).trim()}`)
  }
  args.push(tmp)
  try {
    await execFileAsync('ffmpeg', args, { timeout: 60_000 })
    await fsp.rename(tmp, filePath)
    return true
  } catch {
    await fsp.rm(tmp, { force: true }).catch(() => {})
    return false
  }
}

/**
 * Read artist / album / title / album_artist / track / isrc tags via ffprobe.
 * Fail-soft. Vorbis comment keys come back in varying cases, so lookup is
 * caseless.
 */
export async function readAudioMetaTags(filePath) {
  const empty = { artist: null, album: null, title: null, albumArtist: null, track: null, isrc: null }
  try {
    const { stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v',
        'error',
        '-show_entries',
        'format_tags=artist,album,title,album_artist,track,isrc',
        '-of',
        'json',
        filePath,
      ],
      { timeout: 10_000 },
    )
    const raw = JSON.parse(stdout)?.format?.tags || {}
    const tags = {}
    for (const [key, value] of Object.entries(raw)) {
      tags[key.toLowerCase()] = value
    }
    const clean = (value) =>
      typeof value === 'string' && value.trim() ? value.trim() : null
    return {
      artist: clean(tags.artist),
      album: clean(tags.album),
      title: clean(tags.title),
      albumArtist: clean(tags.album_artist),
      track: clean(tags.track),
      isrc: clean(tags.isrc),
    }
  } catch {
    return empty
  }
}

// Reads the FLAC metadata blocks up to the first audio frame.
async function readFlacMetadata(filePath) {
  const fh = await fsp.open(filePath, 'r')
  try {
    const head = Buffer.alloc(4)
    await fh.read(head, 0, 4, 0)
    if (head.toString('ascii') !== 'fLaC') return null
    const blocks = []
    let offset = 4
    for (;;) {
      const hdr = Buffer.alloc(4)
      const { bytesRead } = await fh.read(hdr, 0, 4, offset)
      if (bytesRead < 4) return null
      const isLast = (hdr[0] & 0x80) !== 0
      const type = hdr[0] & 0x7f
      const length = hdr.readUIntBE(1, 3)
      const data = Buffer.alloc(length)
      await fh.read(data, 0, length, offset + 4)
      blocks.push({ type, data })
      offset += 4 + length
      if (isLast) break
    }
    return { blocks, audioOffset: offset }
  } finally {
    await fh.close()
  }
}

function parseVorbisBlock(data) {
  let o = 0
  const vendorLen = data.readUInt32LE(o)
  o += 4
  const vendor = data.toString('utf8', o, o + vendorLen)
  o += vendorLen
  const count = data.readUInt32LE(o)
  o += 4
  const comments = []
  for (let i = 0; i < count; i++) {
    const len = data.readUInt32LE(o)
    o += 4
    const raw = data.toString('utf8', o, o + len)
    o += len
    const eq = raw.indexOf('=')
    if (eq > 0) comments.push([raw.slice(0, eq), raw.slice(eq + 1)])
  }
  return { vendor, comments }
}

function buildVorbisBlock({ vendor, comments }) {
  const parts = []
  const u32 = (n) => {
    const b = Buffer.alloc(4)
    b.writeUInt32LE(n)
    return b
  }
  const v = Buffer.from(vendor, 'utf8')
  parts.push(u32(v.length), v, u32(comments.length))
  for (const [k, val] of comments) {
    const c = Buffer.from(`${k}=${val}`, 'utf8')
    parts.push(u32(c.length), c)
  }
  return Buffer.concat(parts)
}

/**
 * Vorbis comments of a FLAC as { KEY: [values] } with upper-cased keys, or
 * null when the file is not a readable FLAC.
 */
export async function readFlacComments(filePath) {
  try {
    const meta = await readFlacMetadata(filePath)
    const block = meta?.blocks.find((b) => b.type === 4)
    const out = {}
    if (!block) return meta ? out : null
    for (const [k, v] of parseVorbisBlock(block.data).comments) {
      ;(out[k.toUpperCase()] ||= []).push(v)
    }
    return out
  } catch {
    return null
  }
}

/**
 * Replaces the given Vorbis comment fields in a FLAC, one entry per value, so
 * multi-valued tags (ARTISTS, COMPOSER) can be written, which the ffmpeg
 * remux cannot do. Only the metadata is rebuilt; audio frames are copied
 * byte for byte into a temp file that replaces the original.
 */
export function writeFlacComments(filePath, fields) {
  const key = path.resolve(filePath)
  const previous = stampQueues.get(key) || Promise.resolve()
  const run = previous.catch(() => {}).then(() => rewriteFlacComments(filePath, fields))
  stampQueues.set(key, run)
  const release = () => {
    if (stampQueues.get(key) === run) stampQueues.delete(key)
  }
  run.then(release, release)
  return run
}

async function rewriteFlacComments(filePath, fields) {
  const tmp = path.join(path.dirname(filePath), `.${path.basename(filePath)}.tags-tmp.flac`)
  try {
    const meta = await readFlacMetadata(filePath)
    if (!meta) return false
    const replace = new Set(Object.keys(fields).map((k) => k.toUpperCase()))
    const existing = meta.blocks.find((b) => b.type === 4)
    const vorbis = existing ? parseVorbisBlock(existing.data) : { vendor: 'alacarte', comments: [] }
    vorbis.comments = vorbis.comments.filter(([k]) => !replace.has(k.toUpperCase()))
    for (const [k, values] of Object.entries(fields)) {
      for (const v of values || []) vorbis.comments.push([k.toUpperCase(), String(v)])
    }
    const blocks = meta.blocks.filter((b) => b.type !== 4 && b.type !== 1)
    blocks.splice(1, 0, { type: 4, data: buildVorbisBlock(vorbis) })
    const header = [Buffer.from('fLaC', 'ascii')]
    blocks.forEach((b, i) => {
      const h = Buffer.alloc(4)
      h[0] = (i === blocks.length - 1 ? 0x80 : 0) | b.type
      h.writeUIntBE(b.data.length, 1, 3)
      header.push(h, b.data)
    })
    const out = fs.createWriteStream(tmp)
    out.write(Buffer.concat(header))
    await pipeline(fs.createReadStream(filePath, { start: meta.audioOffset }), out)
    await fsp.rename(tmp, filePath)
    return true
  } catch {
    await fsp.rm(tmp, { force: true }).catch(() => {})
    return false
  }
}
