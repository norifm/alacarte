import test from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { syncDualLyricsInDir, ttmlToLrc } from '../lib/ttmlLrc.mjs'

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

test('syncDualLyricsInDir writes an lrc next to every ttml and keeps an existing lrc', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'alacarte-dual-'))
  const sub = path.join(dir, 'Artist', 'Album')
  await fsp.mkdir(sub, { recursive: true })
  await fsp.writeFile(path.join(sub, '01. New.ttml'), TTML)
  await fsp.writeFile(path.join(sub, '02. Old.ttml'), TTML)
  await fsp.writeFile(path.join(sub, '02. Old.lrc'), 'mine\n')

  await syncDualLyricsInDir(dir)

  assert.equal(await fsp.readFile(path.join(sub, '01. New.lrc'), 'utf8'), '[00:06.39]one\n')
  assert.equal(await fsp.readFile(path.join(sub, '02. Old.lrc'), 'utf8'), 'mine\n')
  await fsp.rm(dir, { recursive: true, force: true })
})
