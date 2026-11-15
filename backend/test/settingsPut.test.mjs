import { test } from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import crypto from 'node:crypto'

const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'alacarte-settings-put-'))
process.env.AMDL_CONFIG_DIR = tmpDir
process.env.AMDL_SECRET_KEY = crypto.randomBytes(32).toString('hex')

const { ensureConfigDir } = await import('../lib/settingsStore.mjs')
await ensureConfigDir(tmpDir)

const { settingsRouter, WRITABLE_KEYS } = await import('../routes/settings.mjs')

test('WRITABLE_KEYS includes namingConvention', () => {
  assert.ok(WRITABLE_KEYS.has('namingConvention'))
})

async function withSettingsServer(fn) {
  const app = express()
  app.use(express.json())
  app.use('/api/settings', settingsRouter)
  const server = http.createServer(app)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  try {
    await fn(`http://127.0.0.1:${port}`)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

async function jsonRequest(base, method, body) {
  const res = await fetch(`${base}/api/settings`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json()
  return { status: res.status, data }
}

test('PUT persists namingConvention qobuz and GET returns it', async () => {
  await withSettingsServer(async (base) => {
    const put = await jsonRequest(base, 'PUT', { namingConvention: 'qobuz' })
    assert.equal(put.status, 200)
    assert.equal(put.data.namingConvention, 'qobuz')

    const get = await jsonRequest(base, 'GET')
    assert.equal(get.status, 200)
    assert.equal(get.data.namingConvention, 'qobuz')
  })
})

test('PUT stores a folder scheme and rejects one that is not artist/album/file', async () => {
  await withSettingsServer(async (base) => {
    try {
      const bad = await jsonRequest(base, 'PUT', { pathTemplate: '$artist/$title' })
      assert.equal(bad.status, 400)
      assert.match(bad.data.error, /artist\/album\/file/)
      assert.equal(bad.data.code, 'pathTemplate.parts')

      const put = await jsonRequest(base, 'PUT', {
        pathTemplate: '$artist/$album ($year)/$track. $title',
        primaryAlbumArtist: true,
      })
      assert.equal(put.status, 200)
      assert.equal(put.data.pathTemplate, '$artist/$album ($year)/$track. $title')
      assert.equal(put.data.primaryAlbumArtist, true)

      const legacy = await jsonRequest(base, 'PUT', { pathTemplate: '$artist/$album/$track. $title' })
      assert.equal(legacy.status, 200)
      assert.equal(legacy.data.pathTemplate, '')
      assert.equal(legacy.data.primaryAlbumArtist, true)
    } finally {
      await jsonRequest(base, 'PUT', { pathTemplate: '', primaryAlbumArtist: false })
    }
  })
})

test('PUT rejects unknown namingConvention values', async () => {
  await withSettingsServer(async (base) => {
    await jsonRequest(base, 'PUT', { namingConvention: 'qobuz' })
    const put = await jsonRequest(base, 'PUT', { namingConvention: 'spotify' })
    assert.equal(put.status, 200)
    assert.equal(put.data.namingConvention, 'qobuz')

    const get = await jsonRequest(base, 'GET')
    assert.equal(get.data.namingConvention, 'qobuz')

    await jsonRequest(base, 'PUT', { namingConvention: 'apple' })
  })
})
