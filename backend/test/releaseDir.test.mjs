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

const { buildMinimalFlacWithTags } = await import('../lib/audioTags.mjs')

async function flac(root, rel, tags = {}) {
  const abs = path.join(root, rel)
  await fsp.mkdir(path.dirname(abs), { recursive: true })
  const extra = tags.album ? { ALBUM: tags.album } : {}
  await fsp.writeFile(abs, buildMinimalFlacWithTags({ isrc: tags.isrc, upc: tags.upc, extra }))
  return abs
}

test('a stray track with a UPC does not claim a folder of another release', async () => {
  await withMusicRoot(async (root, mod) => {
    // "Mixtape" is mostly its own release plus one track of "Album".
    await flac(root, 'Artist/Mixtape/01. A.flac', { upc: '111', isrc: 'AAA000000001' })
    await flac(root, 'Artist/Mixtape/02. B.flac', { upc: '111', isrc: 'AAA000000002' })
    await flac(root, 'Artist/Mixtape/03. C.flac', { upc: '222', isrc: 'BBB000000001' })
    await flac(root, 'Artist/Album/01. C.flac', { upc: '222', isrc: 'BBB000000001' })
    await flac(root, 'Artist/Album/02. D.flac', { upc: '222', isrc: 'BBB000000002' })
    const index = await mod.scanLibrary()
    const lookup = (upc, album) => mod.findExistingReleaseDir({ upc, artists: ['Artist'], album, index })

    assert.equal(await lookup('222', 'Album'), path.join(root, 'Artist', 'Album'))
    // The name does not have to match when most of the folder is the release.
    assert.equal(await lookup('222', 'Album (Remastered)'), path.join(root, 'Artist', 'Album'))
    assert.equal(await lookup('111', 'Something Else'), path.join(root, 'Artist', 'Mixtape'))
  })
})

test('the UPC choice does not depend on scan order', async () => {
  await withMusicRoot(async (root, mod) => {
    // Two folders, each half one release: neither is a majority, the one
    // named like the album wins, whichever was scanned first.
    for (const dir of ['A Side', 'Z Side']) {
      await flac(root, `Artist/${dir}/01. x.flac`, { upc: '333' })
      await flac(root, `Artist/${dir}/02. y.flac`, { upc: '999' })
    }
    const index = await mod.scanLibrary()
    const want = path.join(root, 'Artist', 'Z Side')
    assert.equal(await mod.findExistingReleaseDir({ upc: '333', artists: ['Artist'], album: 'Z Side', index }), want)
    index.albumDirs = new Map([...index.albumDirs].reverse())
    for (const [k, v] of index.upcDirs) index.upcDirs.set(k, new Set([...v].reverse()))
    assert.equal(await mod.findExistingReleaseDir({ upc: '333', artists: ['Artist'], album: 'Z Side', index }), want)
    assert.equal(await mod.findExistingReleaseDir({ upc: '333', artists: ['Nobody'], album: 'Unrelated', index }), null)
  })
})

test('a folder renamed by hand is found by the ISRCs of most of its tracks', async () => {
  await withMusicRoot(async (root, mod) => {
    await flac(root, 'Mad Season/Above (non-deluxe, removed)/01. Wake Up.flac', { isrc: 'USSM10000001' })
    await flac(root, 'Mad Season/Above (non-deluxe, removed)/02. X-Ray Mind.flac', { isrc: 'USSM10000002' })
    await flac(root, 'Mad Season/Above (non-deluxe, removed)/03. River.flac', { isrc: 'USSM10000003' })
    // A compilation that shares one track does not count.
    await flac(root, 'Various/Grunge Hits/07. Wake Up.flac', { isrc: 'USSM10000001' })
    const index = await mod.scanLibrary()
    const isrcs = ['USSM10000001', 'USSM10000002', 'USSM10000003', 'USSM10000004']
    assert.equal(
      await mod.findExistingReleaseDir({ artists: ['Mad Season'], album: 'Above', isrcs, index }),
      path.join(root, 'Mad Season', 'Above (non-deluxe, removed)'),
    )
    assert.equal(
      await mod.findExistingReleaseDir({ artists: ['Mad Season'], album: 'Above', isrcs: ['USSM10000001', 'USSM10000009', 'USSM10000008'], index }),
      null,
    )
  })
})

test('tracks noted during an import are found without another scan', async () => {
  await withMusicRoot(async (root, mod) => {
    const index = await mod.scanLibrary()
    const dest = await flac(root, 'Anyma/Beautiful - Single/01. Beautiful.flac', { isrc: 'QZ0000000001', upc: '444' })
    mod.noteImportedTrack(index, dest, { isrc: 'QZ0000000001', upc: '444', album: 'Beautiful - Single' })
    assert.equal(
      await mod.findExistingReleaseDir({ upc: '444', artists: ['Anyma & Joji'], album: 'Beautiful - Single', index }),
      path.dirname(dest),
    )
    assert.equal(await mod.findSongPathInLibrary('Anyma', 'Beautiful', 'QZ0000000001', index), dest)
    // Singles and playlists are not album folders.
    mod.noteImportedTrack(index, path.join(root, 'Anyma', 'Singles', 'x.flac'), { upc: '555' })
    assert.equal(index.upcDirs.has('555'), false)
  })
})
