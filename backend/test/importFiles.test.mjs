import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import crypto from 'node:crypto'

const tmpConfig = await fsp.mkdtemp(path.join(os.tmpdir(), 'alacarte-imports-'))
const music = await fsp.mkdtemp(path.join(os.tmpdir(), 'alacarte-imports-music-'))
process.env.AMDL_CONFIG_DIR = tmpConfig
process.env.AMDL_MUSIC_PATH = music
process.env.AMDL_SECRET_KEY = crypto.randomBytes(32).toString('hex')

// Fake Apple catalog. One album owns the standalone song link, the artist
// owns one unreleased-in-library album so an artist link produces a queue.
const albumMeta = (id, name, tracks) => ({
  id: String(id),
  type: 'albums',
  attributes: {
    name,
    artistName: 'Import Band',
    releaseDate: '2021-01-01',
    trackCount: tracks.length,
  },
  relationships: {
    artists: { data: [{ id: '9999', type: 'artists', attributes: { name: 'Import Band' } }] },
    tracks: {
      data: tracks.map((t, i) => ({
        id: String(t.id),
        type: 'songs',
        attributes: {
          name: t.name,
          trackNumber: i + 1,
          ...(t.released ? { playParams: { id: String(t.id), kind: 'song' } } : {}),
        },
      })),
    },
  },
})

const catalog = {
  '1111': albumMeta('1111', 'Fresh LP', [{ id: 't1', name: 'One', released: true }]),
  '3333': albumMeta('3333', 'Single Album', [{ id: '5555', name: 'Single Song', released: true }]),
  '8888': albumMeta('8888', 'Artist LP', [
    { id: 't8', name: 'Track A', released: true },
    { id: 't9', name: 'Track B', released: true },
  ]),
  'pl.test': {
    id: 'pl.test',
    type: 'playlists',
    attributes: { name: 'Fake List' },
    relationships: { tracks: { data: [] } },
  },
  '5555': {
    id: '5555',
    type: 'songs',
    attributes: { name: 'Single Song', artistName: 'Import Band' },
    relationships: { albums: { data: [{ id: '3333' }] } },
  },
  '9999': {
    id: '9999',
    type: 'artists',
    attributes: { name: 'Import Band', genreNames: [] },
    relationships: {
      albums: {
        data: [
          {
            id: '8888',
            type: 'albums',
            attributes: { name: 'Artist LP', artistName: 'Import Band', releaseDate: '2021-01-01', trackCount: 2 },
          },
        ],
      },
    },
  },
}

const realFetch = globalThis.fetch
globalThis.fetch = async (url) => {
  const u = String(url)
  if (u === 'https://music.apple.com') return new Response('<script src="/assets/index~abc.js"></script>')
  if (u.includes('/assets/index~')) return new Response('x="eyJa.eyJb.sig"')
  let m
  if ((m = u.match(/\/playlists\/([^/?]+)/)) && catalog[m[1]]) {
    return Response.json({ data: [catalog[m[1]]] })
  }
  if ((m = u.match(/\/albums\/([^/?]+)/)) && catalog[m[1]]) {
    return Response.json({ data: [catalog[m[1]]] })
  }
  if ((m = u.match(/\/songs\/([^/?]+)/)) && catalog[m[1]]) {
    return Response.json({ data: [catalog[m[1]]] })
  }
  if ((m = u.match(/\/artists\/([^/?]+)/)) && catalog[m[1]]) {
    return Response.json({ data: [catalog[m[1]]] })
  }
  throw new Error(`unexpected fetch in test: ${u}`)
}

const { ensureConfigDir, writeSettings } = await import('../lib/settingsStore.mjs')
const { loadSecretsAtBoot } = await import('../lib/secretKey.mjs')
await ensureConfigDir(tmpConfig)
loadSecretsAtBoot(tmpConfig)
await writeSettings({ language: 'en' })

const { importsRouter } = await import('../routes/imports.mjs')
const { setQueuePaused, cancelAllJobs, __test__ } = await import('../lib/queue.mjs')
const { readPlaylistsStore } = await import('../lib/followedPlaylistsStore.mjs')
const { state } = __test__
setQueuePaused(true)
test.after(async () => {
  globalThis.fetch = realFetch
  if (server) await new Promise((resolve) => server.close(resolve))
  await cancelAllJobs()
})

let app
let server

async function startApp() {
    app = express()
    // same limit stack as production: a wide json limit for /api/imports only,
    // the global one would cut bigger csv uploads off
    app.use('/api/imports', express.json({ limit: '2mb' }))
    app.use(express.json())
    app.use('/api/imports', importsRouter)
    server = http.createServer(app)
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
}

async function call(method, route, body) {
    const res = await realFetch(`http://127.0.0.1:${server.address().port}/api/imports${route}`, {
        method,
        headers: { 'content-type': 'application/json' },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    })
    const text = await res.text()
    let json
    try {
        json = JSON.parse(text)
    } catch {
        json = { raw: text }
    }
    return { status: res.status, json }
}

function jobsFor(pred) {
  return [...state.jobs.values()].filter(pred)
}

const MIXED_CSV = [
  'name,url',
  'Fake List,https://music.apple.com/us/playlist/fake-list/pl.test',
  'Fresh LP,https://music.apple.com/us/album/fresh-lp/1111',
  'Fresh LP,https://music.apple.com/us/album/fresh-lp-deluxe/1111',
  'Track,https://music.apple.com/us/album/single-album/3333?i=5555',
  'Song,https://music.apple.com/us/song/single-song/5555',
  'Artist,https://music.apple.com/us/artist/import-band/9999',
  'not a link',
].join('\n')

test('a mixed link file follows playlists, queues albums and songs, watches artists', async () => {
  await startApp()
  const res = await call('POST', '', { files: [{ name: 'labels.csv', content: MIXED_CSV }] })
  assert.equal(res.status, 200)
  const file = res.json.files[0]
  assert.deepEqual(
    {
      name: file.name,
      links: file.counts.links,
      playlists: file.counts.playlists,
      albums: file.counts.albums,
      songs: file.counts.songs,
      artists: file.counts.artists,
      invalid: file.counts.invalid,
      queued: file.counts.queued,
      skippedExisting: file.counts.skippedExisting,
      failed: file.counts.failed.length,
    },
    {
      name: 'labels.csv',
      links: 4, // the deluxe duplicate line collapses into 1111
      playlists: 1,
      albums: 1,
      songs: 1, // the ?i= link and the standalone song link are the same song id
      artists: 1,
      invalid: 2, // csv header + 'not a link'
      queued: 4, // album 1111, song 5555, artist album 8888, playlist pl.test
      skippedExisting: 0,
      failed: 0,
    },
  )
  assert.equal(jobsFor((j) => j.albumId === '1111').length, 1)
  assert.equal(jobsFor((j) => j.songId === '5555').length, 1)
  assert.equal(jobsFor((j) => j.albumId === '8888').length, 1)
  assert.equal(jobsFor((j) => j.playlistId === 'pl.test').length, 1)
  const store = await readPlaylistsStore()
  assert.ok(
    !Object.values(store.playlists).some((p) => p.catalogId === 'pl.test'),
    'imports must not create follow records',
  )
})

test('the file list never exposes file contents', async () => {
  const res = await call('GET', '')
  assert.equal(res.json.files.length, 1)
  assert.equal(res.json.files[0].name, 'labels.csv')
  assert.equal(res.json.files[0].content, undefined)
})

test('a rerun reuses active jobs instead of queueing the links again', async () => {
  const id = (await call('GET', '')).json.files[0].id
  const before = state.jobs.size
  const res = await call('POST', `/${id}/run`)
  assert.equal(res.status, 200)
  assert.equal(res.json.file.id, id)
  assert.equal(res.json.file.counts.queued, 4)
  assert.equal(state.jobs.size, before, 'no new jobs from a rerun')
})

test('a junk-only import still stores a record with the line counted', async () => {
  const res = await call('POST', '', {
    files: [{ name: 'txt.txt', content: 'no links here\nsecond line' }],
  })
  assert.equal(res.status, 200)
  const file = res.json.files[0]
  assert.equal(file.counts.links, 0)
  assert.equal(file.counts.invalid, 2)
  assert.equal(file.counts.failed.length, 0)
})

test('empty and oversized and oversized-batch uploads are rejected', async () => {
  const res = await call('POST', '', { files: [{ name: 'empty.txt', content: '  ' }] })
  assert.equal(res.status, 400)
  const big = 'a'.repeat(400_001)
  const res2 = await call('POST', '', { files: [{ name: 'big.csv', content: big }] })
  assert.equal(res2.status, 413)
  const batch = Array.from({ length: 21 }, (_, i) => ({ name: `f${i}.txt`, content: `x${i}` }))
  const res3 = await call('POST', '', { files: batch })
  assert.equal(res3.status, 413)
})

test('delete removes the record', async () => {
  const res = await call('POST', '', {
    files: [{ name: 'temp.txt', content: 'https://music.apple.com/us/album/fresh-lp/1111' }],
  })
  const id = res.json.files[0].id
  const del = await call('DELETE', `/${encodeURIComponent(id)}`)
  assert.equal(del.json.ok, true)
  const list = (await call('GET', '')).json.files
  assert.ok(!list.some((f) => f.id === id))
  const missing = await call('DELETE', `/${encodeURIComponent(id)}`)
  assert.equal(missing.json.ok, false)
})
