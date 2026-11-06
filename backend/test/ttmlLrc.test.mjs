import test from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { syncTtmlLyricsInDir, ttmlToLrc } from '../lib/ttmlLrc.mjs'

const TTML = '<tt><body><div><p begin="00:06.390" end="00:08.000">one</p></div></body></tt>'

test('word synced ttml comes out as plain lines with the background vocals', () => {
  const ttml =
    '<tt itunes:timing="Word"><body><div><p begin="1.314" end="3.464">' +
    '<span begin="1.314" end="1.451">one</span> <span begin="1.451" end="1.677">t</span>' +
    '<span begin="1.677" end="1.957">wo</span> ' +
    '<span ttm:role="x-bg"><span begin="1.618" end="2.245">(three)</span></span>' +
    '</p></div></body></tt>'
  assert.equal(ttmlToLrc(ttml), '[00:01.31]one two (three)\n')
})

async function withFakeMp4Box(body, fn) {
  const bin = await fsp.mkdtemp(path.join(os.tmpdir(), 'alacarte-fake-mp4box-'))
  await fsp.writeFile(path.join(bin, 'MP4Box'), `#!/bin/sh\n${body}\n`, { mode: 0o755 })
  const prev = process.env.PATH
  process.env.PATH = `${bin}:${prev}`
  try {
    return await fn()
  } finally {
    process.env.PATH = prev
    await fsp.rm(bin, { recursive: true, force: true })
  }
}

const SAVE_TAGS = 'cp "$2" "$3.seen"'

async function stagedTrack(ttml = TTML) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'alacarte-dual-'))
  const sub = path.join(dir, 'Artist', 'Album')
  await fsp.mkdir(sub, { recursive: true })
  await fsp.writeFile(path.join(sub, '01. New.ttml'), ttml)
  await fsp.writeFile(path.join(sub, '01. New.m4a'), 'audio')
  return { dir, sub }
}

test('ttml format swaps the embedded xml for lrc without keeping an lrc sidecar', async () => {
  const { dir, sub } = await stagedTrack()
  await withFakeMp4Box(SAVE_TAGS, () => syncTtmlLyricsInDir(dir))
  assert.equal(await fsp.readFile(path.join(sub, '01. New.m4a.seen'), 'utf8'), 'lyrics=[00:06.39]one\n\n    ')
  assert.deepEqual((await fsp.readdir(sub)).sort(), ['01. New.m4a', '01. New.m4a.seen', '01. New.ttml'])
  await fsp.rm(dir, { recursive: true, force: true })
})

test('both format writes an lrc next to every ttml and keeps an existing lrc', async () => {
  const { dir, sub } = await stagedTrack()
  await fsp.writeFile(path.join(sub, '02. Old.ttml'), TTML)
  await fsp.writeFile(path.join(sub, '02. Old.lrc'), 'mine\n')
  await fsp.writeFile(path.join(sub, '02. Old.m4a'), 'audio')

  await withFakeMp4Box(SAVE_TAGS, () => syncTtmlLyricsInDir(dir, { writeLrc: true }))

  assert.equal(await fsp.readFile(path.join(sub, '01. New.lrc'), 'utf8'), '[00:06.39]one\n')
  assert.equal(await fsp.readFile(path.join(sub, '02. Old.lrc'), 'utf8'), 'mine\n')
  assert.equal(await fsp.readFile(path.join(sub, '02. Old.m4a.seen'), 'utf8'), 'lyrics=mine\n\n    ')
  await fsp.rm(dir, { recursive: true, force: true })
})

test('a lyric line that looks like a tag cannot overwrite another tag', async () => {
  const { dir, sub } = await stagedTrack(
    '<tt itunes:timing="None"><p>one</p><p>title=two</p><p>three = four</p></tt>',
  )
  await withFakeMp4Box(SAVE_TAGS, () => syncTtmlLyricsInDir(dir))
  assert.equal(
    await fsp.readFile(path.join(sub, '01. New.m4a.seen'), 'utf8'),
    'lyrics=one\n title=two\nthree = four\n\n    ',
  )
  await fsp.rm(dir, { recursive: true, force: true })
})

test('a failed embed keeps the track and cleans up its tag file', async () => {
  const { dir, sub } = await stagedTrack()
  await withFakeMp4Box('exit 1', () => syncTtmlLyricsInDir(dir))
  assert.deepEqual((await fsp.readdir(sub)).sort(), ['01. New.m4a', '01. New.ttml'])
  await fsp.rm(dir, { recursive: true, force: true })
})
