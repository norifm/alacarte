import test from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { syncDualLyricsInDir } from '../lib/ttmlLrc.mjs'

const TTML = '<tt><body><div><p begin="00:06.390" end="00:08.000">one</p></div></body></tt>'

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
