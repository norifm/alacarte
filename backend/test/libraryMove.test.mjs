import { test, describe, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const configDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'alacarte-move-config-'))
const music = await fsp.mkdtemp(path.join(os.tmpdir(), 'alacarte-move-music-'))
process.env.AMDL_CONFIG_DIR = configDir
process.env.AMDL_MUSIC_PATH = music

const {
  targetFor,
  planLibraryMove,
  previewLibraryMove,
  startLibraryMove,
  stopLibraryMove,
  undoLibraryMove,
  initLibraryMove,
  waitForLibraryMove,
  readJournal,
  __test__,
} = await import('../lib/libraryMove.mjs')
const { parsePathTemplate } = await import('../lib/pathTemplate.mjs')
const { readSettings } = await import('../lib/settingsStore.mjs')
const { buildMinimalFlacWithTags } = await import('../lib/audioTags.mjs')
const { losesPlaysOnMove, navidromeMoveRisk, parseServerVersion } = await import('../lib/navidromeApi.mjs')
const { isQueueHeld, releaseQueue } = await import('../lib/queue.mjs')

const YEAR = '$artist/$album ($year)/$track. $title'
const DASH = '$artist/$album/$track - $title'

function scheme(template, primary = false) {
  return { layout: parsePathTemplate(template), primary }
}

function flac(extra) {
  return buildMinimalFlacWithTags({ extra })
}

async function put(rel, body) {
  const file = path.join(music, rel)
  await fsp.mkdir(path.dirname(file), { recursive: true })
  await fsp.writeFile(file, body)
}

async function tree() {
  const out = []
  async function walk(dir) {
    const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => [])
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
    for (const entry of entries) {
      const abs = path.join(dir, entry.name)
      const rel = path.relative(music, abs)
      if (entry.isDirectory()) {
        out.push(`d\t${rel}`)
        await walk(abs)
      } else {
        const body = await fsp.readFile(abs)
        out.push(`f\t${body.length}\t${rel}\t${body.toString('base64')}`)
      }
    }
  }
  await walk(music)
  return out.join('\n')
}

function audioCount(snapshot) {
  return snapshot.split('\n').filter((line) => line.includes('.flac')).length
}

async function resetLibrary() {
  await waitForLibraryMove().catch(() => {})
  if (isQueueHeld()) releaseQueue('library-move')
  Object.assign(__test__.state, {
    running: false,
    mode: 'move',
    phase: 'idle',
    total: 0,
    scanned: 0,
    moved: 0,
    inPlace: 0,
    skipped: 0,
    failed: 0,
    playlistsUpdated: 0,
    skippedItems: [],
    current: null,
    startedAt: null,
    finishedAt: null,
    stopRequested: false,
    error: null,
    canUndo: false,
  })
  await fsp.rm(music, { recursive: true, force: true })
  await fsp.mkdir(music)
  await fsp.rm(path.join(configDir, 'library-move'), { recursive: true, force: true })
  await fsp.rm(path.join(configDir, 'settings.json'), { force: true })
}

describe('library move', { concurrency: 1 }, () => {
  beforeEach(resetLibrary)

  test('an unchanged scheme leaves every album where it is', async () => {
    await put('Daft Punk/Random Access Memories/08. Get Lucky.flac', flac({ TITLE: 'Get Lucky', TRACKNUMBER: '8' }))
    const before = await tree()
    const plan = await planLibraryMove({
      from: { pathTemplate: '', primaryAlbumArtist: false },
      to: { pathTemplate: '$artist/$album/$track. $title', primaryAlbumArtist: false },
    })
    assert.equal(plan.inPlace, 1)
    assert.equal(plan.items.length, 0)
    assert.equal(await tree(), before)
  })

  test('a year already on the folder is not added a second time', () => {
    const album = {
      artistDir: 'Daft Punk',
      albumDir: 'Meta - EP (2021)',
      tags: { year: '2021', albumArtist: 'Daft Punk', albumArtists: [] },
      files: [{ name: '01. Meta.flac', tags: { title: 'Meta', track: 1 } }],
    }
    const target = targetFor(album, scheme(''), scheme(YEAR))
    assert.equal(target.albumName, 'Meta - EP (2021)')
    assert.equal(target.artistName, 'Daft Punk')
  })

  test('a hand-renamed folder keeps its name when the scheme has no year', () => {
    const target = targetFor(
      { artistDir: 'Mad Season', albumDir: 'Above (non-deluxe, removed)', tags: {}, files: [] },
      scheme(''),
      scheme('$artist/$album/$track. $title'),
    )
    assert.equal(target.artistName, 'Mad Season')
    assert.equal(target.albumName, 'Above (non-deluxe, removed)')
    assert.deepEqual(target.files, [])
  })

  test('the primary artist switch moves a collab and leaves a singles folder', () => {
    const tags = { albumArtist: 'Anyma & Joji', albumArtists: ['Anyma', 'Joji'], year: '2024' }
    const moved = targetFor(
      { kind: 'album', artistDir: 'Anyma & Joji', albumDir: 'Beautiful - Single', tags, files: [] },
      scheme('', false),
      scheme('', true),
    )
    assert.equal(moved.artistName, 'Anyma')
    assert.equal(moved.albumName, 'Beautiful - Single')
    const singles = targetFor(
      { kind: 'singles', artistDir: 'Anyma & Joji', albumDir: 'Singles', tags, files: [{ name: '01. Song.flac', tags: { title: 'Song', track: 1 } }] },
      scheme('', false),
      scheme(DASH, true),
    )
    assert.equal(singles.artistName, 'Anyma & Joji')
    assert.equal(singles.albumName, 'Singles')
    assert.deepEqual(singles.files, [])
    const untagged = targetFor(
      { kind: 'album', artistDir: 'Anyma & Joji', albumDir: 'Beautiful - Single', tags: {}, files: [] },
      scheme('', false),
      scheme('', true),
    )
    assert.equal(untagged.skip, 'noArtistCredits')
    const tyler = targetFor(
      { kind: 'album', artistDir: 'Tyler, The Creator', albumDir: 'CHROMAKOPIA', tags: { albumArtist: 'Tyler, The Creator' }, files: [] },
      scheme('', false),
      scheme('', true),
    )
    assert.equal(tyler.skip, undefined)
    assert.equal(tyler.artistName, 'Tyler, The Creator')
    assert.equal(tyler.albumName, 'CHROMAKOPIA')
  })

  test('a file with no title and no number is skipped instead of renamed', () => {
    const target = targetFor(
      {
        artistDir: 'A',
        albumDir: 'B',
        tags: {},
        files: [{ name: 'track.flac', tags: {} }],
      },
      scheme('$artist/$album/$artist - $title'),
      scheme('$artist/$album/$title'),
    )
    assert.equal(target.skip, 'missingTags')
  })

  test('the dry run changes nothing and the real run moves sidecars, art and the version marker', async () => {
    const audio = flac({
      TITLE: 'Get Lucky',
      TRACKNUMBER: '8',
      DATE: '2013-05-17',
      ALBUM: 'Random Access Memories',
      ALBUMARTIST: 'Daft Punk',
    })
    await put('Daft Punk/Random Access Memories/08. Get Lucky.flac', audio)
    await put('Daft Punk/Random Access Memories/08. Get Lucky.lrc', 'line')
    await put('Daft Punk/Random Access Memories/cover.jpg', 'cover')
    await put('Daft Punk/Random Access Memories/.alacarte-version', 'lossless')
    const collab = flac({
      TITLE: 'Beautiful',
      TRACKNUMBER: '1',
      DATE: '2024-03-01',
      ALBUM: 'Beautiful - Single',
      ALBUMARTIST: 'Anyma & Joji',
      ALBUMARTISTS: 'Anyma;Joji',
    })
    await put('Anyma & Joji/Beautiful - Single/01. Beautiful.flac', collab)
    const playlist = '#EXTM3U\n../Daft Punk/Random Access Memories/08. Get Lucky.flac\n../Anyma & Joji/Beautiful - Single/01. Beautiful.flac\n'
    await put('Playlists/mix.m3u8', playlist)
    const before = await tree()
    const planned = await planLibraryMove({
      from: { pathTemplate: '', primaryAlbumArtist: false },
      to: { pathTemplate: YEAR, primaryAlbumArtist: true },
    })
    assert.equal(planned.items.length, 2)
    assert.equal(await tree(), before)

    const preview = await previewLibraryMove({ pathTemplate: YEAR, primaryAlbumArtist: true })
    assert.equal(preview.samples[0].path, 'Daft Punk/Random Access Memories (2013)/08. Get Lucky.flac')
    assert.equal(preview.samples[1].path, 'Anyma/Beautiful - Single (2024)/01. Beautiful.flac')
    assert.equal(preview.move, 2)
    assert.equal(preview.navidrome.losesPlays, false)

    await startLibraryMove({ pathTemplate: YEAR, primaryAlbumArtist: true })
    await waitForLibraryMove()
    assert.equal(__test__.state.error, null)
    assert.equal(isQueueHeld(), false)
    const moved = await tree()
    assert.notEqual(moved, before)
    assert.equal(audioCount(moved), audioCount(before))
    assert.equal(await fsp.readFile(path.join(music, 'Daft Punk/Random Access Memories (2013)/08. Get Lucky.lrc'), 'utf8'), 'line')
    assert.equal(await fsp.readFile(path.join(music, 'Daft Punk/Random Access Memories (2013)/cover.jpg'), 'utf8'), 'cover')
    assert.equal(await fsp.readFile(path.join(music, 'Daft Punk/Random Access Memories (2013)/.alacarte-version'), 'utf8'), 'lossless')
    assert.equal(await fsp.readFile(path.join(music, 'Anyma/Beautiful - Single (2024)/01. Beautiful.flac')).then((b) => b.length), collab.length)
    await assert.rejects(fsp.stat(path.join(music, 'Anyma & Joji')))
    const playlistNow = await fsp.readFile(path.join(music, 'Playlists/mix.m3u8'), 'utf8')
    assert.match(playlistNow, /\.\.\/Daft Punk\/Random Access Memories \(2013\)\/08\. Get Lucky\.flac/)
    assert.match(playlistNow, /\.\.\/Anyma\/Beautiful - Single \(2024\)\/01\. Beautiful\.flac/)
    const saved = await readSettings()
    assert.equal(saved.pathTemplate, YEAR)
    assert.equal(saved.primaryAlbumArtist, true)

    await undoLibraryMove()
    await waitForLibraryMove()
    assert.equal(__test__.state.error, null)
    assert.equal(await tree(), before)
    const restored = await readSettings()
    assert.equal(restored.pathTemplate, '')
    assert.equal(restored.primaryAlbumArtist, false)
    assert.equal(await fsp.readFile(path.join(music, 'Playlists/mix.m3u8'), 'utf8'), playlist)
  })

  test('filled names follow the new file pattern, and a taken name skips the album', async () => {
    await put('A/Album/01. Hello.flac', flac({ TITLE: 'Hello', TRACKNUMBER: '1', ALBUMARTIST: 'A' }))
    await put('A/Album/01. Hello.lrc', 'words')
    await put('A/Album/cover.jpg', 'jpg')
    await startLibraryMove({ pathTemplate: DASH, primaryAlbumArtist: false })
    await waitForLibraryMove()
    assert.equal(await fsp.readFile(path.join(music, 'A/Album/01 - Hello.lrc'), 'utf8'), 'words')
    assert.equal(await fsp.readFile(path.join(music, 'A/Album/cover.jpg'), 'utf8'), 'jpg')
    await assert.rejects(fsp.stat(path.join(music, 'A/Album/01. Hello.flac')))

    await resetLibrary()
    await put('A/Album/01. Hello.flac', flac({ TITLE: 'Hello', TRACKNUMBER: '1' }))
    await put('A/Album/01 - Hello.flac', flac({ TITLE: 'Hello', TRACKNUMBER: '1' }))
    const before = await tree()
    const plan = await planLibraryMove({
      from: { pathTemplate: '', primaryAlbumArtist: false },
      to: { pathTemplate: DASH, primaryAlbumArtist: false },
    })
    assert.equal(plan.skipped[0]?.reason, 'fileCollision')
    await startLibraryMove({ pathTemplate: DASH, primaryAlbumArtist: false })
    await waitForLibraryMove()
    assert.equal(await tree(), before)
  })

  test('only the primary artist switch moves the collab folder', async () => {
    await put('Daft Punk/Random Access Memories/08. Get Lucky.flac', flac({ TITLE: 'Get Lucky', TRACKNUMBER: '8', ALBUMARTIST: 'Daft Punk' }))
    await put(
      'Anyma & Joji/Beautiful - Single/01. Beautiful.flac',
      flac({ TITLE: 'Beautiful', TRACKNUMBER: '1', ALBUMARTIST: 'Anyma & Joji', ALBUMARTISTS: 'Anyma;Joji' }),
    )
    await put('Anyma & Joji/Singles/01. Loose.flac', flac({ TITLE: 'Loose', TRACKNUMBER: '1', ALBUMARTIST: 'Anyma & Joji', ALBUMARTISTS: 'Anyma;Joji' }))
    await startLibraryMove({ pathTemplate: '', primaryAlbumArtist: true })
    await waitForLibraryMove()
    assert.equal(__test__.state.moved, 1)
    await fsp.stat(path.join(music, 'Daft Punk/Random Access Memories/08. Get Lucky.flac'))
    await fsp.stat(path.join(music, 'Anyma/Beautiful - Single/01. Beautiful.flac'))
    await fsp.stat(path.join(music, 'Anyma & Joji/Singles/01. Loose.flac'))
    await assert.rejects(fsp.stat(path.join(music, 'Anyma & Joji/Beautiful - Single')))
  })

  test('a folder that already has the new name is skipped and not overwritten', async () => {
    await put('Artist/Album (2013)/01. Keep.flac', flac({ TITLE: 'Keep', TRACKNUMBER: '1', DATE: '2013', ALBUMARTIST: 'Artist' }))
    await put('Artist/Album/01. Move.flac', flac({ TITLE: 'Move', TRACKNUMBER: '1', DATE: '2013-01-01', ALBUMARTIST: 'Artist' }))
    const before = await tree()
    const plan = await planLibraryMove({
      from: { pathTemplate: '', primaryAlbumArtist: false },
      to: { pathTemplate: YEAR, primaryAlbumArtist: false },
    })
    assert.ok(plan.skipped.some((item) => item.reason === 'collision' && item.path.endsWith('Artist/Album')))
    await startLibraryMove({ pathTemplate: YEAR, primaryAlbumArtist: false })
    await waitForLibraryMove()
    const keep = await fsp.readFile(path.join(music, 'Artist/Album (2013)/01. Keep.flac'))
    const still = await fsp.readFile(path.join(music, 'Artist/Album/01. Move.flac'))
    assert.equal(keep.length > 0, true)
    assert.equal(still.length > 0, true)
    assert.match(await tree(), /Artist\/Album\/01\. Move\.flac/)
    assert.ok((await tree()).includes('01. Keep.flac'))
    assert.equal(audioCount(await tree()), audioCount(before))
  })

  test('a move interrupted after a rename resumes the rest and does not repeat a finished step', async () => {
    for (const [artist, album, title] of [
      ['One', 'First', 'Alpha'],
      ['Two', 'Second', 'Beta'],
      ['Three', 'Third', 'Gamma'],
    ]) {
      await put(`${artist}/${album}/01. ${title}.flac`, flac({ TITLE: title, TRACKNUMBER: '1', DATE: '2001', ALBUMARTIST: artist }))
    }
    const from = { pathTemplate: '', primaryAlbumArtist: false }
    const to = { pathTemplate: YEAR, primaryAlbumArtist: false }
    const plan = await planLibraryMove({ from, to })
    const steps = __test__.stepsFor(plan)
    const journal = {
      version: 1,
      createdAt: Date.now(),
      state: 'running',
      from,
      to,
      caseInsensitive: plan.caseInsensitive,
      albums: plan.albums,
      inPlace: plan.inPlace,
      skipped: plan.skipped,
      items: plan.items,
      steps,
    }
    const groups = new Map()
    steps.forEach((step, index) => {
      const list = groups.get(step.album) || []
      list.push(index)
      groups.set(step.album, list)
    })
    const albums = [...groups.keys()]
    assert.equal(albums.length, 3)
    const dir = path.join(configDir, 'library-move')
    await fsp.mkdir(dir, { recursive: true })
    await fsp.writeFile(path.join(dir, 'journal.json'), JSON.stringify(journal))
    for (const index of groups.get(albums[0])) {
      assert.equal(await __test__.applyStep(steps[index]), 'done')
    }
    await fsp.writeFile(path.join(dir, 'done.log'), `${groups.get(albums[0]).join('\n')}\n`)
    for (const index of groups.get(albums[1])) await __test__.applyStep(steps[index])
    __test__.state.running = false
    await initLibraryMove()
    await waitForLibraryMove()
    assert.equal(__test__.state.error, null)
    for (const album of ['First', 'Second', 'Third']) {
      const matches = (await tree()).split('\n').filter((line) => line.includes(`${album} (2001)`))
      assert.equal(matches.length > 0, true, album)
    }
    assert.equal((await tree()).includes('.alacarte-move'), false)
    const again = await tree()
    await initLibraryMove()
    assert.equal(await tree(), again)
  })

  test('a case-only rename goes through a temporary name and a conflict is left untouched', async () => {
    await put('Artist/Album/01. A.flac', 'audio')
    const steps = __test__.stepsFor({
      caseInsensitive: true,
      items: [{ from: 'Artist/Album', to: 'Artist/album', files: [{ from: '01. A.flac', to: '01. a.flac' }], createParent: false }],
    })
    assert.ok(steps.some((step) => String(step.to).includes('.alacarte-move')))
    for (const step of steps) assert.equal(await __test__.applyStep(step), 'done')
    assert.equal(await fsp.readFile(path.join(music, 'Artist/album/01. a.flac'), 'utf8'), 'audio')
    await assert.rejects(fsp.stat(path.join(music, 'Artist/Album')))

    await put('Artist/album/keep.flac', 'keep')
    const result = await __test__.applyStep({ op: 'rename', from: 'Artist/album/01. a.flac', to: 'Artist/album/keep.flac' })
    assert.equal(result, 'conflict')
    assert.equal(await fsp.readFile(path.join(music, 'Artist/album/keep.flac'), 'utf8'), 'keep')
    assert.equal(await fsp.readFile(path.join(music, 'Artist/album/01. a.flac'), 'utf8'), 'audio')
  })

  test('stopping when nothing is running reports that', () => {
    assert.deepEqual(stopLibraryMove(), { ok: false, running: false })
  })
})

test('navidrome before 0.55 loses plays when a file moves', () => {
  assert.deepEqual(parseServerVersion('0.54.5 (a1b2c3)'), [0, 54, 5])
  assert.equal(losesPlaysOnMove('0.54.5'), true)
  assert.equal(losesPlaysOnMove('0.55.0'), false)
  assert.equal(losesPlaysOnMove('1.0.0'), false)
  assert.equal(losesPlaysOnMove(null), false)
  assert.equal(losesPlaysOnMove('develop'), false)
  assert.deepEqual(navidromeMoveRisk(' (128dd794)'), { losesPlays: false, versionUnknown: true })
  assert.deepEqual(navidromeMoveRisk('0.54.1'), { losesPlays: true, versionUnknown: false })
  assert.deepEqual(navidromeMoveRisk('0.55.0'), { losesPlays: false, versionUnknown: false })
})

test('a journal records an undo that has nothing to undo', async () => {
  await resetLibrary()
  await assert.rejects(undoLibraryMove(), (err) => err.code === 'libraryMove.nothingToUndo')
  assert.equal(await readJournal(), null)
})
