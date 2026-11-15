import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'

process.env.AMDL_CONFIG_DIR = await fsp.mkdtemp(path.join(os.tmpdir(), 'alacarte-matchtrack-'))
const { __test__ } = await import('../lib/queue.mjs')
const { matchTrackForFile } = __test__

test('on a multi-disc album the title picks the disc a track number belongs to', () => {
  const tracks = [
    { name: 'A-Z', trackNumber: 1, discNumber: 1 },
    { name: 'Oohu', trackNumber: 1, discNumber: 5 },
    { name: 'Feeling', trackNumber: 4, discNumber: 4 },
  ]
  assert.equal(matchTrackForFile('01. Oohu.flac', tracks).discNumber, 5)
  assert.equal(matchTrackForFile('01. A-Z.flac', tracks).discNumber, 1)
  // An unknown title on a shared number still gets a track, as before.
  assert.equal(matchTrackForFile('01. Renamed.flac', tracks).name, 'A-Z')
  assert.equal(matchTrackForFile('Feeling.flac', tracks).trackNumber, 4)
  assert.equal(matchTrackForFile('09. Nothing.flac', tracks), null)
})
