import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fsp from 'node:fs/promises'

import {
  parsePathTemplate,
  primaryFolderArtist,
  renderFileStem,
  renderSegment,
} from '../lib/pathTemplate.mjs'
import { resolveLibraryDir } from '../lib/folderLayout.mjs'

const collab = {
  artistName: 'Anyma & Joji',
  isCompilation: false,
  artists: [{ name: 'Anyma' }, { name: 'Joji' }],
}

test('an empty scheme is the historical layout', () => {
  const parsed = parsePathTemplate('  ')
  assert.equal(parsed.custom, false)
  assert.equal(parsed.customFile, false)
  assert.equal(parsed.stored, '')
  assert.equal(parsePathTemplate('$artist/$album/$track. $title').custom, false)
  assert.equal(parsePathTemplate('$Artist/$Album/$Track. $Title').stored, '')
})

test('the requested scheme renders artist, year and track', () => {
  const parsed = parsePathTemplate('$artist/$album ($year)/$track. $title')
  assert.equal(parsed.custom, true)
  assert.equal(parsed.customFile, false)
  const vars = { artist: 'Daft Punk', album: 'Random Access Memories', year: 2013, track: 8, title: 'Get Lucky' }
  assert.equal(renderSegment(parsed.artist, vars), 'Daft Punk')
  assert.equal(renderSegment(parsed.album, vars), 'Random Access Memories (2013)')
  assert.equal(renderFileStem(parsed.file, vars, '.flac'), '08. Get Lucky')
})

test('a missing year or track number does not leave empty punctuation', () => {
  const vars = { artist: 'Daft Punk', album: 'Random Access Memories (2013)', title: 'Get Lucky' }
  assert.equal(renderSegment('$album ($year)', vars), 'Random Access Memories')
  assert.equal(renderFileStem('$track. $title', vars), 'Get Lucky')
  assert.equal(renderFileStem('$disc-$track. $title', { ...vars, track: 8 }), '08. Get Lucky')
  assert.equal(renderFileStem('$disc-$track. $title', { ...vars, disc: 2, track: 8 }), '2-08. Get Lucky')
})

test('file and folder tokens cannot escape the library', () => {
  assert.equal(renderFileStem('$title', { title: '..' }), '')
  assert.equal(renderFileStem('$title', { title: 'A/B:C' }), 'A_B_C')
  assert.equal(renderSegment('$artist', { artist: 'A/B' }), 'A_B')
  assert.equal(renderFileStem('$title.flac', { title: 'Get Lucky' }, '.flac'), 'Get Lucky')
})

test('schemes that are not artist/album/file are rejected', () => {
  for (const bad of [
    '$artist/$title',
    '$artist/$album/$track/$title',
    '/$artist/$album/$title',
    '$artist/../$album/$title',
    '$album/$artist/$title',
    '$artist/$year/$title',
    '$artist/$album/$disc',
    '$artist/$album/$name',
    'C:\\music\\$artist\\$album\\$title',
  ]) {
    assert.ok(parsePathTemplate(bad).error, bad)
  }
})

test('primary artist is the first credit, except compilations and single artists', () => {
  assert.equal(primaryFolderArtist(collab, false), null)
  assert.equal(primaryFolderArtist(collab, true), 'Anyma')
  assert.equal(primaryFolderArtist({ ...collab, isCompilation: true }, true), null)
  assert.equal(
    primaryFolderArtist({ artistName: 'Anyma', artists: [{ name: 'Anyma' }] }, true),
    null,
  )
})

test('the default directory ignores the year and a custom scheme appends it', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'alacarte-layout-'))
  try {
    const legacy = await resolveLibraryDir(root, {
      artist: 'Daft Punk',
      album: 'Random Access Memories',
      year: '2013',
    })
    assert.equal(legacy, path.join(root, 'Daft Punk', 'Random Access Memories'))

    const custom = await resolveLibraryDir(root, {
      artist: 'Daft Punk',
      album: 'Random Access Memories',
      year: '2013',
      layout: '$artist/$album ($year)/$track. $title',
    })
    assert.equal(custom, path.join(root, 'Daft Punk', 'Random Access Memories (2013)'))
  } finally {
    await fsp.rm(root, { recursive: true, force: true })
  }
})

test('an album already in the library is kept, and a path outside it is not', async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'alacarte-layout-'))
  const outside = await fsp.mkdtemp(path.join(os.tmpdir(), 'alacarte-layout-out-'))
  try {
    const existing = path.join(root, 'Daft Punk', 'Random Access Memories')
    await fsp.mkdir(existing, { recursive: true })
    const kept = await resolveLibraryDir(root, {
      artist: 'Daft Punk',
      album: 'Random Access Memories',
      year: '2013',
      layout: '$artist/$album ($year)/$title',
      existingDir: existing,
    })
    assert.equal(kept, await fsp.realpath(existing))

    const fresh = await resolveLibraryDir(root, {
      artist: 'Daft Punk',
      album: 'Random Access Memories',
      year: '2013',
      layout: '$artist/$album ($year)/$title',
      existingDir: outside,
    })
    assert.equal(fresh, path.join(root, 'Daft Punk', 'Random Access Memories (2013)'))

    const link = path.join(root, 'Daft Punk', 'escape')
    await fsp.symlink(outside, link)
    const linked = await resolveLibraryDir(root, {
      artist: 'Daft Punk',
      album: 'Random Access Memories',
      year: '2013',
      layout: '$artist/$album ($year)/$title',
      existingDir: link,
    })
    assert.equal(linked, path.join(root, 'Daft Punk', 'Random Access Memories (2013)'))
  } finally {
    await fsp.rm(root, { recursive: true, force: true })
    await fsp.rm(outside, { recursive: true, force: true })
  }
})
