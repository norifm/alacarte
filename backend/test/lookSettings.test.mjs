import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'
import crypto from 'node:crypto'

const tmpDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'alacarte-look-cfg-'))
process.env.AMDL_CONFIG_DIR = tmpDir
process.env.AMDL_SECRET_KEY = crypto.randomBytes(32).toString('hex')

const { ensureConfigDir, readSettings, readPublicSettings, writeSettings } =
  await import('../lib/settingsStore.mjs')
await ensureConfigDir(tmpDir)

const { WRITABLE_KEYS } = await import('../routes/settings.mjs')

test('the season and appearance can be written', () => {
  assert.ok(WRITABLE_KEYS.has('season'))
  assert.ok(WRITABLE_KEYS.has('appearance'))
})

test('the look follows the calendar and the system by default', async () => {
  const pub = await readPublicSettings()
  assert.equal(pub.season, 'follow')
  assert.equal(pub.appearance, 'system')
})

test('a chosen season and appearance are kept, unknown ones fall back', async () => {
  await writeSettings({ season: 'winter', appearance: 'midnight' })
  let s = await readSettings()
  assert.equal(s.season, 'winter')
  assert.equal(s.appearance, 'midnight')

  await writeSettings({ season: 'monsoon', appearance: 'sepia' })
  s = await readSettings()
  assert.equal(s.season, 'follow')
  assert.equal(s.appearance, 'system')
})
