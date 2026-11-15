import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'

async function withMusicRoot(fn) {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'alacarte-release-'))
  const prev = process.env.AMDL_MUSIC_PATH
  process.env.AMDL_MUSIC_PATH = dir
  try {
    const mod = await import(`../lib/libraryIndex.mjs?release=${Date.now()}-${Math.random()}`)
    await fn(dir, mod)
  } finally {
    process.env.AMDL_MUSIC_PATH = prev
    await fsp.rm(dir, { recursive: true, force: true })
  }
}

test('an existing album folder is reused across a year suffix and a shorter artist', async () => {
  await withMusicRoot(async (root, mod) => {
    const album = path.join(root, 'Anyma & Joji', 'Beautiful - Single')
    await fsp.mkdir(album, { recursive: true })
    await fsp.writeFile(path.join(album, '01. Beautiful.flac'), 'x')

    const byYear = await mod.findExistingReleaseDir({
      artists: ['Anyma & Joji'],
      album: 'Beautiful - Single',
    })
    assert.equal(byYear, album)

    const byPrimary = await mod.findExistingReleaseDir({
      artists: ['Anyma'],
      album: 'Beautiful - Single (2024)',
    })
    assert.equal(byPrimary, album)
  })
})

test('two different artists with the same album title are not merged', async () => {
  await withMusicRoot(async (root, mod) => {
    for (const artist of ['ABBA', 'Queen']) {
      const album = path.join(root, artist, 'Greatest Hits')
      await fsp.mkdir(album, { recursive: true })
      await fsp.writeFile(path.join(album, '01. Track.flac'), 'x')
    }
    const found = await mod.findExistingReleaseDir({
      artists: ['ABBA & Queen'],
      album: 'Greatest Hits',
    })
    assert.equal(found, null)

    const abba = await mod.findExistingReleaseDir({
      artists: ['ABBA'],
      album: 'Greatest Hits',
    })
    assert.equal(abba, path.join(root, 'ABBA', 'Greatest Hits'))
  })
})

test('a lossless album is not reused for an Atmos download', async () => {
  await withMusicRoot(async (root, mod) => {
    const album = path.join(root, 'Daft Punk', 'Random Access Memories')
    await fsp.mkdir(album, { recursive: true })
    await fsp.writeFile(path.join(album, '01. Get Lucky.flac'), 'x')
    const found = await mod.findExistingReleaseDir({
      artists: ['Daft Punk'],
      album: 'Random Access Memories',
      variant: 'atmos',
    })
    assert.equal(found, null)
  })
})
