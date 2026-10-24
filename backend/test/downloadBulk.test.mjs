import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import crypto from 'node:crypto'

const tmpConfig = await fsp.mkdtemp(path.join(os.tmpdir(), 'alacarte-dl-bulk-'))
const music = await fsp.mkdtemp(path.join(os.tmpdir(), 'alacarte-dl-bulk-music-'))
process.env.AMDL_CONFIG_DIR = tmpConfig
process.env.AMDL_MUSIC_PATH = music
process.env.AMDL_SECRET_KEY = crypto.randomBytes(32).toString('hex')

const { buildMinimalFlacWithTags } = await import('../lib/audioTags.mjs')

// The user's library already holds one of the catalog albums: a budget
// release that alacarte itself downloaded earlier.
const inLibraryDir = path.join(music, 'Bulk Band', 'Already There')
await fsp.mkdir(inLibraryDir, { recursive: true })
await fsp.writeFile(
  path.join(inLibraryDir, '01. Doubt.flac'),
  buildMinimalFlacWithTags({ isrc: 'CNA011200001', upc: '4895123400012' }),
)

// Fake Apple catalog for the bulk route. The unreleased album must come back
// as an error, not a skip; have1 is on disk, everything else is fresh.
const album = (id, attrs, tracks) => ({
  id,
  type: 'albums',
  attributes: {
    name: attrs.name,
    artistName: 'Bulk Band',
    releaseDate: attrs.releaseDate || '2020-01-01',
    trackCount: tracks.length,
    upc: attrs.upc || null,
  },
  relationships: {
    artists: { data: [{ id: 'art1', type: 'artists', attributes: { name: 'Bulk Band' } }] },
    tracks: {
      data: tracks.map((t, i) => ({
        id: t.id,
        type: 'songs',
        attributes: {
          name: t.name,
          trackNumber: i + 1,
          isrc: t.isrc || null,
          ...(t.released ? { playParams: { id: t.id, kind: 'song' } } : {}),
        },
      })),
    },
  },
})

const catalog = {
  have1: album('have1', { name: 'Already There', upc: '4895123400012' }, [
    { id: 't1', name: 'Doubt', isrc: 'CNA011200001', released: true },
  ]),
  new2: album('new2', { name: 'Fresh LP', upc: '4895123400099' }, [
    { id: 't2', name: 'New Song', isrc: 'CNA0112000099', released: true },
  ]),
  later3: album('later3', { name: 'Future Cuts', releaseDate: '2027-01-01' }, [
    { id: 't3', name: 'Not Out Yet', released: false },
  ]),
  fresh4: album('fresh4', { name: 'Late Summer', upc: '4895123400040' }, [
    { id: 't4', name: 'Afterthought', isrc: 'CNA0112000040', released: true },
  ]),
  dup5: album('dup5', { name: 'Dupes', upc: '4895123400044' }, [
    { id: 't5', name: 'Once Only', isrc: 'CNA0112000044', released: true },
  ]),
}

const realFetch = globalThis.fetch
globalThis.fetch = async (url) => {
  const u = String(url)
  if (u === 'https://music.apple.com') return new Response('<script src="/assets/index~abc.js"></script>')
  if (u.includes('/assets/index~')) return new Response('x="eyJa.eyJb.sig"')
  const id = u.match(/\/albums\/([^/?]+)/)?.[1]
  if (id && catalog[id]) return Response.json({ data: [catalog[id]] })
  throw new Error(`unexpected fetch in test: ${u}`)
}

const { ensureConfigDir, writeSettings } = await import('../lib/settingsStore.mjs')
const { loadSecretsAtBoot } = await import('../lib/secretKey.mjs')
await ensureConfigDir(tmpConfig)
loadSecretsAtBoot(tmpConfig)
await writeSettings({ language: 'en' })

const { downloadRouter } = await import('../routes/download.mjs')
const { setQueuePaused, cancelAllJobs, __test__ } = await import('../lib/queue.mjs')
const { state } = __test__
setQueuePaused(true)
test.after(() => {
  globalThis.fetch = realFetch
  return cancelAllJobs()
})

async function postBulk(body) {
  const app = express()
  app.use(express.json())
  app.use('/api/download', downloadRouter)
  const server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const res = await realFetch(`http://127.0.0.1:${server.address().port}/api/download/bulk`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { status: res.status, json: await res.json() }
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

function jobsFor(albumId) {
  return [...state.jobs.values()].filter((j) => j.albumId === albumId)
}

test('bulk skips an album already in the library and still queues the rest', async () => {
  const res = await postBulk({ albumIds: ['have1', 'new2'], quality: 'flac' })
  assert.equal(res.status, 200)
  assert.deepEqual(res.json, {
    requested: 2,
    queued: 1,
    skippedExisting: 1,
    errors: [],
  })
  assert.equal(jobsFor('have1').length, 0, 'owned album was not queued again')
  assert.equal(jobsFor('new2').length, 1, 'fresh album reached the queue')
})

test('bulk continues after a skip and after an error, in request order', async () => {
  // fresh4 ends up queued even though the request starts behind a skip
  // (have1) and passes through a failing album (later3) in the middle.
  const res = await postBulk({ albumIds: ['have1', 'later3', 'fresh4'], quality: 'flac' })
  assert.equal(res.status, 200)
  assert.equal(res.json.skippedExisting, 1)
  assert.equal(res.json.queued, 1, 'albums after the skip and the error still queue')
  assert.equal(jobsFor('fresh4').length, 1)
  assert.equal(jobsFor('later3').length, 0)
  assert.equal(res.json.errors.length, 1)
  assert.equal(res.json.errors[0].albumId, 'later3')
  assert.equal(res.json.errors[0].code, 'NOT_RELEASED', 'unreleased album is an error, not a skip')
})

test('bulk dedupes a repeated albumId and queues it once', async () => {
  const res = await postBulk({ albumIds: ['dup5', 'dup5', 'dup5'], quality: 'flac' })
  assert.equal(res.status, 200)
  assert.equal(res.json.requested, 1)
  assert.equal(res.json.queued, 1)
  assert.equal(res.json.skippedExisting, 0)
  assert.equal(res.json.errors.length, 0)
})

test('bulk rejects an empty albumIds list', async () => {
  const res = await postBulk({ albumIds: [] })
  assert.equal(res.status, 400)
  assert.equal(res.json.error, 'albumIds required')
  const res2 = await postBulk({})
  assert.equal(res2.status, 400)
})
