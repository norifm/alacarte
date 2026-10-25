import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import express from 'express'
import http from 'node:http'

const tmpConfig = await fsp.mkdtemp(path.join(os.tmpdir(), 'alacarte-auto-storefront-'))
process.env.AMDL_CONFIG_DIR = tmpConfig
process.env.AMDL_SECRET_KEY = 'c'.repeat(64)

const { ensureConfigDir, readSettings, writeSettings } = await import('../lib/settingsStore.mjs')
const { loadSecretsAtBoot } = await import('../lib/secretKey.mjs')
await ensureConfigDir(tmpConfig)
loadSecretsAtBoot(tmpConfig)
const { settingsRouter } = await import('../routes/settings.mjs')
const { detectAndApplyStorefront } = await import('../lib/storefrontAuto.mjs')

async function call(method, url, body) {
  const app = express()
  app.use(express.json())
  app.use('/api/settings', settingsRouter)
  const server = http.createServer(app)
  await new Promise((r) => server.listen(0, '127.0.0.1', r))
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${url}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    })
    return { status: res.status, json: await res.json() }
  } finally {
    await new Promise((r) => server.close(r))
  }
}

test('a fresh install has auto-detect on', async () => {
  assert.equal((await readSettings()).autoStorefront, true)
})

test('a settings file from before auto-detect keeps its storefront', async () => {
  await fsp.writeFile(path.join(tmpConfig, 'settings.json'), JSON.stringify({ storefront: 'jp' }))
  const s = await readSettings()
  assert.equal(s.autoStorefront, false)
  assert.equal(s.storefront, 'jp')
  assert.deepEqual(await detectAndApplyStorefront(), { ok: false, reason: 'disabled' })
})

test('picking a storefront by hand turns auto-detect off', async () => {
  await writeSettings({ storefront: 'us', autoStorefront: true })
  const { json } = await call('PUT', '/api/settings', { storefront: 'de' })
  assert.equal(json.storefront, 'de')
  assert.equal(json.autoStorefront, false)
})

test('turning auto-detect on still saves when there is no media-user-token to detect with', async () => {
  const { status, json } = await call('PUT', '/api/settings', { autoStorefront: true })
  assert.equal(status, 200)
  assert.equal(json.autoStorefront, true)
  assert.equal(json.storefront, 'de')
  assert.deepEqual(await detectAndApplyStorefront(), { ok: false, reason: 'no-media-user-token' })
})
