import express from 'express'
import { parseAppleMusicUrl } from '../lib/appleMusicUrl.mjs'
import {
    enqueueAlbum,
    enqueuePlaylist,
    enqueueSong,
} from '../lib/queue.mjs'
import { readSettings } from '../lib/settingsStore.mjs'
import { loadArtistCatalog } from '../lib/artistCatalog.mjs'
import { hasAlbumInLibrary, scanLibraryOnce } from '../lib/libraryIndex.mjs'
import {
    listImportFiles,
    getImportFile,
    addImportFile,
    saveImportFileRun,
    removeImportFile,
    MAX_FILE_CHARS,
} from '../lib/importFilesStore.mjs'

export const importsRouter = express.Router()

const MAX_FILES_PER_REQUEST = 20
const MAX_FAILED_STORED = 50

importsRouter.get('/', async (_req, res) => {
    try {
        res.json({ files: await listImportFiles() })
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
})

importsRouter.post('/', async (req, res) => {
    let incoming = req.body?.files
    if (!Array.isArray(incoming) && typeof req.body?.content === 'string') {
        incoming = [{ name: req.body.name, content: req.body.content }]
    }
    if (!Array.isArray(incoming) || incoming.length === 0) {
        return res.status(400).json({ error: 'files required' })
    }
    incoming = incoming.filter(
        (f) => typeof f?.content === 'string' && f.content.trim(),
    )
    if (incoming.length === 0) {
        return res.status(400).json({ error: 'files required' })
    }
    if (incoming.length > MAX_FILES_PER_REQUEST) {
        return res.status(413).json({ error: 'too many files in one request' })
    }
    const oversized = incoming.find((f) => f.content.length > MAX_FILE_CHARS)
    if (oversized) {
        return res.status(413).json({ error: `${oversized.name || 'a file'} is too large` })
    }

    const results = []
    for (const file of incoming) {
        const name = String(file?.name || '').trim().slice(0, 160) || 'import'
        try {
            const counts = await runImport(file.content)
            results.push(await addImportFile({ name, content: file.content, counts }))
        } catch (err) {
            results.push({ name, error: err.message || 'Import failed' })
        }
    }
    res.json({ files: results })
})

importsRouter.post('/:id/run', async (req, res) => {
    try {
        const file = await getImportFile(req.params.id)
        if (!file) return res.status(404).json({ error: 'file not found' })
        const counts = await runImport(file.content)
        const updated = await saveImportFileRun(file.id, { counts })
        if (!updated) return res.status(404).json({ error: 'file not found' })
        res.json({ file: updated })
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
})

importsRouter.delete('/:id', async (req, res) => {
    try {
        res.json({ ok: await removeImportFile(req.params.id) })
    } catch (err) {
        res.status(500).json({ error: err.message })
    }
})

// Playlists first (they are the usual bulk case in a curved csv), then
// artists, then albums and songs. Every link downloads as-is: the same
// queue paths the app uses everywhere, so a rerun lands on the same
// already-queued / already-in-library skip paths and is idempotent.
async function runImport(content) {
    const { items: extracted, invalid } = extractLinks(content)
    const kindOrder = { playlist: 0, artist: 1, album: 2, song: 3 }
    const items = extracted
        .slice()
        .sort((a, b) => (kindOrder[a.kind] ?? 9) - (kindOrder[b.kind] ?? 9))
    const counts = {
        links: extracted.length,
        playlists: 0,
        albums: 0,
        songs: 0,
        artists: 0,
        invalid,
        queued: 0,
        skippedExisting: 0,
        failed: [],
    }
    const failed = new Set()
    const pushFail = (item, err) => {
        const key = `${item.kind}:${item.id}`
        if (failed.has(key) || counts.failed.length >= MAX_FAILED_STORED) return
        failed.add(key)
        counts.failed.push({
            kind: item.kind,
            id: item.id,
            error: err?.message || 'Failed',
        })
    }
    let libIndex = null

    for (const item of items) {
        try {
            switch (item.kind) {
                case 'playlist': {
                    counts.playlists += 1
                    try {
                        // imports never follow: the playlist queues as-is,
                        // already having it in the library just skips
                        await enqueuePlaylist({
                            playlistId: item.id,
                            storefront: item.storefront,
                            quality: null,
                        })
                        counts.queued += 1
                    } catch (err) {
                        if (err?.code === 'ALREADY_IN_LIBRARY') {
                            counts.skippedExisting += 1
                        } else {
                            pushFail(item, err)
                        }
                    }
                    break
                }
                case 'artist': {
                    counts.artists += 1
                    // no following: the import resolves the artist discography
                    // once and queues the releases that are still missing
                    const settings = await readSettings()
                    const catalog = await loadArtistCatalog({
                        artistId: item.id,
                        storefront: item.storefront || settings.storefront,
                        language: settings.language,
                        explicitFilter: settings.explicitFilter,
                    })
                    if (!catalog?.artist) throw new Error('artist not found')
                    libIndex = libIndex || (await scanLibraryOnce())
                    for (const album of catalog.albums || []) {
                        if (
                            album.artistName &&
                            album.name &&
                            (await hasAlbumInLibrary(album.artistName, album.name, libIndex))
                        ) {
                            continue
                        }
                        try {
                            await enqueueAlbum({
                                albumId: album.id,
                                expectedArtistId: item.id,
                                quality: null,
                            })
                            counts.queued += 1
                        } catch (err) {
                            if (err?.code === 'ALREADY_IN_LIBRARY') {
                                counts.skippedExisting += 1
                            } else {
                                pushFail(item, err)
                            }
                        }
                    }
                    break
                }
                case 'album': {
                    counts.albums += 1
                    try {
                        await enqueueAlbum({
                            albumId: item.id,
                            storefront: item.storefront,
                            quality: null,
                        })
                        counts.queued += 1
                    } catch (err) {
                        if (err?.code === 'ALREADY_IN_LIBRARY') {
                            counts.skippedExisting += 1
                        } else {
                            pushFail(item, err)
                        }
                    }
                    break
                }
                case 'song': {
                    counts.songs += 1
                    try {
                        await enqueueSong({
                            songId: item.id,
                            albumId: item.albumId || null,
                            storefront: item.storefront,
                            quality: null,
                        })
                        counts.queued += 1
                    } catch (err) {
                        if (err?.code === 'ALREADY_IN_LIBRARY') {
                            counts.skippedExisting += 1
                        } else {
                            pushFail(item, err)
                        }
                    }
                    break
                }
                default:
                    counts.invalid += 1
            }
        } catch (err) {
            pushFail(item, err)
        }
    }
    return counts
}

// Ignore the line format entirely: scrub every url candidate out of the text
// (one link per line, but a csv column or a paragraph both work) and keep
// only apple music links that resolve to a catalog id. Anything else counts
// as an invalid line and is reported, not fatal.
function extractLinks(content) {
    const seen = new Set()
    const items = []
    const kindAllowed = ['album', 'song', 'playlist', 'artist']
    let invalid = 0
    for (const line of String(content).split(/\r?\n/)) {
        if (!line.trim()) continue
        let found = false
        for (const raw of line.match(/https?:\/\/[^\s"'<>]+/g) || []) {
            const candidate = raw.replace(/[)\].,;'"]+$/, '')
            const parsed = parseAppleMusicUrl(candidate)
            if (!parsed || parsed.unsupported || !parsed.id) continue
            if (!kindAllowed.includes(parsed.kind)) continue
            const key = `${parsed.kind}:${parsed.id}`
            if (seen.has(key)) {
                // same link again in the very file - valid, already tracked
                found = true
                continue
            }
            seen.add(key)
            items.push({
                kind: parsed.kind,
                id: String(parsed.id),
                albumId: parsed.albumId ? String(parsed.albumId) : null,
                storefront: parsed.storefront || null,
                line,
            })
            found = true
        }
        if (!found) invalid += 1
    }
    return { items, invalid }
}
