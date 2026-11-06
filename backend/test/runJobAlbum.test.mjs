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

const bin = await fsp.mkdtemp(path.join(os.tmpdir(), 'alacarte-runjob-bin-'))
const script = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 })
script('MP4Box', 'echo "MP4Box - GPAC version 2.2"')
script(
  'apple-music-dl',
  `d="Artist/Record (2020)"; mkdir -p "$d"
cp "${alac}" "$d/01. Song (feat. Guest).m4a"
cp "${alac}" "$d/02. Other.m4a"
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
