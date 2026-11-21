import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import crypto from 'node:crypto'

// Fake amdp copies a real ALAC file into staging; MP4Box is faked, ffmpeg
// is the real one, so the album goes through conversion and import.
const fixtures = await fsp.mkdtemp(path.join(os.tmpdir(), 'alacarte-runjob-fixture-'))
const alac = path.join(fixtures, 'tone.m4a')
execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'alac', alac])
// A collab single as amdp tags it: one display string, a barcode, no year.
const collab = path.join(fixtures, 'collab.m4a')
execFileSync('ffmpeg', [
  '-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-c:a', 'alac', '-movflags', 'use_metadata_tags',
  '-metadata', 'title=Beautiful', '-metadata', 'album=Beautiful - Single', '-metadata', 'album_artist=Anyma & Joji',
  '-metadata', 'artist=Anyma & Joji', '-metadata', 'track=1/1', '-metadata', 'UPC=000000000009', '-metadata', 'ISRC=QZ0000000009',
  collab,
])

const bin = await fsp.mkdtemp(path.join(os.tmpdir(), 'alacarte-runjob-bin-'))
const script = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 })
script('MP4Box', 'echo "MP4Box - GPAC version 2.2"')
script(
  'apple-music-dl',
  `d="Artist/Record (2020)"; mkdir -p "$d"
# A fill asks for one track (?i=<id>); track 2 is the only one filled.
case "$*" in
  *pl.collab*) c="Anyma & Joji/Beautiful - Single"; mkdir -p "$c"; cp "${collab}" "$c/01. Beautiful.m4a" ;;
  *i=*) cp "${alac}" "$d/02. Other.m4a" ;;
  *) cp "${alac}" "$d/01. Song (feat. Guest).m4a"; cp "${alac}" "$d/02. Other.m4a" ;;
esac
if grep -q 'lrc-format: "ttml"' config.yaml; then
  echo '<tt><body><div><p begin="1.000">one</p></div></body></tt>' > "$d/02. Other.ttml"
fi
echo "Track 1 of 2: Song"`,
)
process.env.PATH = `${bin}:${process.env.PATH}`

const wrapperServers = []
const ports = []
for (let i = 0; i < 3; i++) {
  const s = net.createServer((c) => c.destroy())
  await new Promise((r) => s.listen(0, '127.0.0.1', r))
  wrapperServers.push(s)
  ports.push(s.address().port)
}

const tmpConfig = await fsp.mkdtemp(path.join(os.tmpdir(), 'alacarte-runjob-'))
const tmpMusic = await fsp.mkdtemp(path.join(os.tmpdir(), 'alacarte-runjob-music-'))
process.env.AMDL_CONFIG_DIR = tmpConfig
process.env.AMDL_MUSIC_PATH = tmpMusic
process.env.AMDL_SECRET_KEY = crypto.randomBytes(32).toString('hex')
process.env.AMDL_WRAPPER_HOST = '127.0.0.1'
process.env.AMDL_WRAPPER_DECRYPT_PORT = String(ports[0])
process.env.AMDL_WRAPPER_M3U8_PORT = String(ports[1])
process.env.AMDL_WRAPPER_ACCOUNT_PORT = String(ports[2])
process.env.AMDL_WRAPPER_SUPERVISOR_PORT = '1'

const { ensureConfigDir, writeSettings } = await import('../lib/settingsStore.mjs')
const { loadSecretsAtBoot } = await import('../lib/secretKey.mjs')
await ensureConfigDir(tmpConfig)
loadSecretsAtBoot(tmpConfig)
const { __test__ } = await import('../lib/queue.mjs')
const { buildMinimalFlacWithTags, readTrackTags } = await import('../lib/audioTags.mjs')
const { state, tickQueue, applyQobuzFileNames } = __test__

test.after(() => {
  for (const s of wrapperServers) s.close()
})

async function runAlbumJob(fields = {}) {
  const job = {
    id: crypto.randomUUID(),
    kind: 'album',
    status: 'queued',
    progress: 0,
    albumId: '1',
    albumTitle: 'Record',
    artist: 'Artist',
    storefront: 'us',
    quality: 'flac',
    createdAt: Date.now(),
    stats: { total: 2, done: 0, failed: 0 },
    ...fields,
  }
  state.jobs.set(job.id, job)
  state.queue.push(job.id)
  await tickQueue()
  const deadline = Date.now() + 20_000
  while (state.active.size > 0) {
    if (Date.now() > deadline) throw new Error('job did not finish')
    await new Promise((r) => setTimeout(r, 25))
  }
  return job
}

test('an album downloads, converts to flac and lands in the library', async () => {
  const job = await runAlbumJob()
  assert.equal(job.status, 'done', job.error)
  assert.equal(job.progress, 100)
  assert.equal(job.stats.converted, 2)
  const dir = path.join(tmpMusic, 'Artist', 'Record')
  const files = await fsp.readdir(dir)
  assert.deepEqual(files.filter((f) => /\.(flac|m4a)$/.test(f)).sort(), ['01. Song (feat. Guest).flac', '02. Other.flac'])
  assert.ok(!files.some((f) => f.includes('.converting.')), 'no conversion temp files')
})

test('a playlist in both format gets its lrc sidecars too', async () => {
  // Tracks already in the library are reused, sidecars and all.
  await fsp.rm(path.join(tmpMusic, 'Artist'), { recursive: true, force: true })
  await writeSettings({ lyricsFormat: 'both' })
  const job = await runAlbumJob({ kind: 'playlist', playlistId: 'pl.1', albumTitle: 'Mix' })
  await writeSettings({ lyricsFormat: 'lrc' })
  assert.equal(job.status, 'done', job.error)
  const files = (await fsp.readdir(tmpMusic, { recursive: true })).map((f) => path.basename(f))
  assert.ok(files.includes('02. Other.ttml'), files.join(', '))
  assert.ok(files.includes('02. Other.lrc'), files.join(', '))
})

test('the qobuz convention renames tracks before they are imported', async () => {
  await fsp.rm(path.join(tmpMusic, 'Artist'), { recursive: true, force: true })
  await writeSettings({ namingConvention: 'qobuz' })
  const job = await runAlbumJob()
  assert.equal(job.status, 'done', job.error)
  const files = (await fsp.readdir(path.join(tmpMusic, 'Artist', 'Record'))).filter((f) => f.endsWith('.flac')).sort()
  assert.deepEqual(files, ['01. Song.flac', '02. Other.flac'])
})

async function resetLibrarySettings() {
  await writeSettings({
    namingConvention: 'apple',
    pathTemplate: '',
    primaryAlbumArtist: false,
    lyricsFormat: 'lrc',
  })
}

test('a folder scheme is used for an album that is not already in the library', async () => {
  await fsp.rm(path.join(tmpMusic, 'Artist'), { recursive: true, force: true })
  await resetLibrarySettings()
  try {
    await writeSettings({ pathTemplate: '$artist/$album ($year)/$track - $title' })
    const job = await runAlbumJob({ year: '2013' })
    assert.equal(job.status, 'done', job.error)
    const dir = path.join(tmpMusic, 'Artist', 'Record (2013)')
    const files = (await fsp.readdir(dir)).filter((f) => f.endsWith('.flac')).sort()
    assert.deepEqual(files, ['01 - Song (feat. Guest).flac', '02 - Other.flac'])
    assert.equal(await fsp.stat(path.join(tmpMusic, 'Artist', 'Record')).catch(() => null), null)
  } finally {
    await resetLibrarySettings()
    await fsp.rm(path.join(tmpMusic, 'Artist'), { recursive: true, force: true })
  }
})

test('an album already on disk stays in its folder when the scheme changes', async () => {
  await fsp.rm(path.join(tmpMusic, 'Artist'), { recursive: true, force: true })
  const existing = path.join(tmpMusic, 'Artist', 'Record')
  await fsp.mkdir(existing, { recursive: true })
  await fsp.writeFile(path.join(existing, '00. Keep.flac'), 'keep')
  await resetLibrarySettings()
  try {
    await writeSettings({ pathTemplate: '$artist/$album ($year)/$track. $title' })
    const job = await runAlbumJob({ year: '2013' })
    assert.equal(job.status, 'done', job.error)
    assert.equal(job.finalDir, existing)
    const files = await fsp.readdir(existing)
    assert.equal(await fsp.readFile(path.join(existing, '00. Keep.flac'), 'utf8'), 'keep')
    assert.ok(files.includes('01. Song (feat. Guest).flac'))
    assert.equal(await fsp.stat(path.join(tmpMusic, 'Artist', 'Record (2013)')).catch(() => null), null)
  } finally {
    await resetLibrarySettings()
    await fsp.rm(path.join(tmpMusic, 'Artist'), { recursive: true, force: true })
  }
})

test('the primary artist is the folder only when that album is not already filed under the full credit', async () => {
  await fsp.rm(path.join(tmpMusic, 'Anyma & Joji'), { recursive: true, force: true })
  await fsp.rm(path.join(tmpMusic, 'Anyma'), { recursive: true, force: true })
  await resetLibrarySettings()
  try {
    await writeSettings({ primaryAlbumArtist: true })
    const fresh = await runAlbumJob({
      artist: 'Anyma & Joji',
      folderArtist: 'Anyma',
      albumArtists: ['Anyma', 'Joji'],
    })
    assert.equal(fresh.status, 'done', fresh.error)
    assert.equal(fresh.finalDir, path.join(tmpMusic, 'Anyma', 'Record'))
    const freshTags = await readTrackTags(path.join(fresh.finalDir, '01. Song (feat. Guest).flac'))
    assert.equal(freshTags.albumArtist, 'Anyma')
    assert.equal(freshTags.albumArtistCredit, 'Anyma & Joji')
    assert.deepEqual(freshTags.albumArtists, ['Anyma', 'Joji'])
    await fsp.rm(path.join(tmpMusic, 'Anyma'), { recursive: true, force: true })

    const existing = path.join(tmpMusic, 'Anyma & Joji', 'Record')
    await fsp.mkdir(existing, { recursive: true })
    await fsp.writeFile(
      path.join(existing, '00. Keep.flac'),
      buildMinimalFlacWithTags({ extra: { TITLE: 'Keep', ALBUM: 'Record', ALBUMARTIST: 'Anyma & Joji' } }),
    )
    const again = await runAlbumJob({
      artist: 'Anyma & Joji',
      folderArtist: 'Anyma',
      albumArtists: ['Anyma', 'Joji'],
    })
    assert.equal(again.status, 'done', again.error)
    assert.equal(again.finalDir, existing)
    assert.equal((await readTrackTags(path.join(existing, '00. Keep.flac'))).albumArtist, 'Anyma & Joji')
    assert.equal((await readTrackTags(path.join(existing, '01. Song (feat. Guest).flac'))).albumArtist, null)
    assert.equal(await fsp.stat(path.join(tmpMusic, 'Anyma')).catch(() => null), null)
  } finally {
    await resetLibrarySettings()
    await fsp.rm(path.join(tmpMusic, 'Anyma & Joji'), { recursive: true, force: true })
    await fsp.rm(path.join(tmpMusic, 'Anyma'), { recursive: true, force: true })
  }
})

test('playlist tracks get the primary artist folder and a year from Apple', async () => {
  await resetLibrarySettings()
  const asked = []
  __test__.setPlaylistAlbumLookup(async (req) => {
    asked.push(req)
    const info = { year: '2024', artistName: 'Anyma & Joji', artists: ['Anyma', 'Joji'], isCompilation: false, upc: '000000000009' }
    return { byUpc: new Map([['000000000009', info]]), byIsrc: new Map() }
  })
  try {
    await writeSettings({ pathTemplate: '$artist/$album ($year)/$track. $title', primaryAlbumArtist: true })
    const job = await runAlbumJob({ kind: 'playlist', playlistId: 'pl.collab', albumTitle: 'Mix', artist: 'Some Curator' })
    assert.equal(job.status, 'done', job.error)
    const file = path.join(tmpMusic, 'Anyma', 'Beautiful - Single (2024)', '01. Beautiful.flac')
    assert.ok(await fsp.stat(file).catch(() => null), (await fsp.readdir(tmpMusic, { recursive: true })).join(', '))
    const playlistTags = await readTrackTags(file)
    assert.equal(playlistTags.albumArtist, 'Anyma')
    assert.equal(playlistTags.albumArtistCredit, 'Anyma & Joji')
    assert.deepEqual(playlistTags.albumArtists, ['Anyma', 'Joji'])
    assert.equal(playlistTags.artist, 'Anyma & Joji')
    assert.equal(asked.length, 1)
    assert.deepEqual(asked[0].upcs, ['000000000009'])
    // The curator is not an artist the release is looked up under.
    assert.equal(await fsp.stat(path.join(tmpMusic, 'Some Curator')).catch(() => null), null)
  } finally {
    __test__.setPlaylistAlbumLookup(null)
    await resetLibrarySettings()
    for (const d of ['Anyma', 'Anyma & Joji', 'Playlists']) await fsp.rm(path.join(tmpMusic, d), { recursive: true, force: true })
  }
})

async function fillIntoExisting(existingNames, pathTemplate) {
  await fsp.rm(path.join(tmpMusic, 'Artist'), { recursive: true, force: true })
  const existing = path.join(tmpMusic, 'Artist', 'Record')
  await fsp.mkdir(existing, { recursive: true })
  // Tagged like a real download: the names are explained by the tags.
  for (const name of existingNames) {
    await fsp.writeFile(
      path.join(existing, name),
      buildMinimalFlacWithTags({ extra: { TITLE: 'Song (feat. Guest)', TRACKNUMBER: '1', ARTIST: 'Artist', ALBUM: 'Record' } }),
    )
  }
  await resetLibrarySettings()
  await writeSettings({ pathTemplate })
  const job = await runAlbumJob({
    year: '2013',
    stats: { total: 1, done: 0, failed: 0 },
    missingTracks: [{ id: '2', name: 'Other', trackNumber: 2, discNumber: 1 }],
    trackIsrcs: [
      { name: 'Song (feat. Guest)', trackNumber: 1, discNumber: 1, isrc: 'QZ0000000001' },
      { name: 'Other', trackNumber: 2, discNumber: 1, isrc: 'QZ0000000002' },
    ],
  })
  assert.equal(job.status, 'done', job.error)
  assert.equal(job.finalDir, existing)
  return (await fsp.readdir(existing)).filter((f) => f.endsWith('.flac')).sort()
}

test('tracks filled into an existing folder are named like the files already there', async () => {
  try {
    // The folder predates the scheme: the fill keeps amdp's "02. Other".
    assert.deepEqual(
      await fillIntoExisting(['01. Song (feat. Guest).flac'], '$artist/$album ($year)/$track - $title'),
      ['01. Song (feat. Guest).flac', '02. Other.flac'],
    )
    // A folder written with another file scheme keeps that one.
    assert.deepEqual(
      await fillIntoExisting(['01 - Song (feat. Guest).flac'], '$artist/$album ($year)/$track. $title'),
      ['01 - Song (feat. Guest).flac', '02 - Other.flac'],
    )
    // Also with the default layout, which otherwise never renames.
    assert.deepEqual(
      await fillIntoExisting(['Artist - 01 - Song (feat. Guest).flac'], ''),
      ['Artist - 01 - Song (feat. Guest).flac', 'Artist - 02 - Other.flac'],
    )
  } finally {
    await resetLibrarySettings()
    await fsp.rm(path.join(tmpMusic, 'Artist'), { recursive: true, force: true })
  }
})

test('qobuz renaming keeps a file whose new name is taken', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'alacarte-qobuz-'))
  for (const f of ['01. A (feat. B).flac', '01. A (feat. B).lrc', '02. C.flac', '02. C (feat. D).flac', 'cover.jpg']) {
    await fsp.writeFile(path.join(dir, f), f)
  }
  await applyQobuzFileNames(dir)
  assert.deepEqual((await fsp.readdir(dir)).sort(), ['01. A.flac', '01. A.lrc', '02. C (feat. D).flac', '02. C.flac', 'cover.jpg'])
  assert.equal(await fsp.readFile(path.join(dir, '02. C.flac'), 'utf8'), '02. C.flac')
  await applyQobuzFileNames(path.join(dir, 'missing'))
})
