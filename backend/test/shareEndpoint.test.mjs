import assert from 'node:assert/strict'
import test from 'node:test'
import express from 'express'

import { createShareHandler } from '../routes/share.mjs'

async function call(deps, body) {
  const app = express().use(express.json()).post('/share', createShareHandler(deps))
  const server = app.listen(0, '127.0.0.1')
  await new Promise((r) => server.once('listening', r))
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/share`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { status: res.status, json: await res.json() }
  } finally {
    server.close()
  }
}

const fail = (name) => async () => { throw new Error(`${name} must not be called`) }

test('single track link (?i=) downloads only that track', async () => {
  let seen
  const r = await call(
    { enqueueSong: async (o) => { seen = o; return { albumTitle: 'Live', artist: 'Sp' } }, enqueueAlbum: fail('album'), enqueuePlaylist: fail('playlist') },
    { url: 'https://music.apple.com/de/album/und-ganz-doll-mich-20-jahre-sp%C3%A4ter-live/1442520923?i=1442521142' },
  )
  assert.equal(r.status, 202)
  assert.equal(r.json.status, 'queued')
  assert.deepEqual(seen, { songId: '1442521142', albumId: '1442520923', storefront: 'de' })
  assert.match(r.json.message, /^Titel in der Warteschlange: Sp – Live/)
})

test('album link downloads the album', async () => {
  let seen
  const r = await call(
    { enqueueAlbum: async (o) => { seen = o; return { albumTitle: 'OK Computer', artist: 'Radiohead' } }, enqueueSong: fail('song'), enqueuePlaylist: fail('playlist') },
    { url: 'https://music.apple.com/gb/album/ok-computer/1109714933' },
  )
  assert.equal(r.status, 202)
  assert.deepEqual(seen, { albumId: '1109714933', storefront: 'gb' })
})

test('playlist link downloads the playlist', async () => {
  let seen
  const r = await call(
    { enqueuePlaylist: async (o) => { seen = o; return {} }, enqueueSong: fail('song'), enqueueAlbum: fail('album') },
    { url: 'https://music.apple.com/de/playlist/mix/pl.u-abc123' },
  )
  assert.equal(r.status, 202)
  assert.equal(seen.playlistId, 'pl.u-abc123')
})

test('artist, foreign and missing links are rejected without enqueueing', async () => {
  const deps = { enqueueAlbum: fail('a'), enqueueSong: fail('s'), enqueuePlaylist: fail('p') }
  const artist = await call(deps, { url: 'https://music.apple.com/de/artist/radiohead/657515' })
  assert.equal(artist.status, 400)
  assert.equal(artist.json.status, 'unsupported')
  const foreign = await call(deps, { url: 'https://example.com/x' })
  assert.equal(foreign.status, 400)
  assert.equal(foreign.json.status, 'invalid_link')
  const none = await call(deps, {})
  assert.equal(none.status, 400)
})

test('already in library maps to 409 with a message', async () => {
  const err = Object.assign(new Error('Already in library'), { code: 'ALREADY_IN_LIBRARY', statusCode: 409 })
  const r = await call(
    { enqueueSong: async () => { throw err }, enqueueAlbum: fail('a'), enqueuePlaylist: fail('p') },
    { url: 'https://music.apple.com/de/album/x/1?i=2' },
  )
  assert.equal(r.status, 409)
  assert.equal(r.json.status, 'already_in_library')
  assert.equal(r.json.message, 'Already in library')
})

test('the route is mounted behind the integration token check', async () => {
  const os = await import('node:os')
  const path = await import('node:path')
  const fsp = await import('node:fs/promises')
  process.env.AMDL_CONFIG_DIR = await fsp.mkdtemp(path.join(os.tmpdir(), 'alacarte-share-'))
  process.env.AMDL_MUSIC_PATH = await fsp.mkdtemp(path.join(os.tmpdir(), 'alacarte-music-'))
  const { integrationRouter } = await import('../routes/integration.mjs')
  const app = express().use(express.json()).use('/api/integration/v1', integrationRouter)
  const server = app.listen(0, '127.0.0.1')
  await new Promise((r) => server.once('listening', r))
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api/integration/v1/share`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://music.apple.com/de/album/x/1' }),
    })
    assert.ok([401, 404].includes(res.status), `expected 401/404, got ${res.status}`)
  } finally {
    server.close()
  }
})
