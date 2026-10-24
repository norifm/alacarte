import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'

const CONFIG_DIR = process.env.AMDL_CONFIG_DIR || '/config'
const IMPORTS_FILE = path.join(CONFIG_DIR, 'import-files.json')

// A pasted csv of links stays small, but uploads are cut off here instead of
// blowing up the store file if something weird lands in the picker.
export const MAX_FILE_CHARS = 400_000

const EMPTY_STORE = {
    version: 1,
    files: {},
}

// Same read-modify-write serialization as the other stores: one write at a
// time so concurrent imports cannot clobber each other with stale snapshots.
let _writeChain = Promise.resolve()
function serialize(operation) {
    const run = _writeChain.then(operation, operation)
    _writeChain = run.then(
        () => undefined,
        () => undefined,
    )
    return run
}

function normalizeCounts(counts) {
    return {
        links: Number(counts?.links) || 0,
        playlists: Number(counts?.playlists) || 0,
        albums: Number(counts?.albums) || 0,
        songs: Number(counts?.songs) || 0,
        artists: Number(counts?.artists) || 0,
        invalid: Number(counts?.invalid) || 0,
        queued: Number(counts?.queued) || 0,
        skippedExisting: Number(counts?.skippedExisting) || 0,
        failed: Array.isArray(counts?.failed)
            ? counts.failed
                  .slice(0, 200)
                  .map((f) => ({
                      kind: String(f?.kind || ''),
                      id: String(f?.id || ''),
                      error: String(f?.error || ''),
                  }))
            : [],
    }
}

function normalizeFile(id, file) {
    return {
        id,
        name: String(file?.name || '').trim().slice(0, 160) || 'import',
        addedAt: Number(file?.addedAt) || Date.now(),
        content: typeof file?.content === 'string' ? file.content.slice(0, MAX_FILE_CHARS) : '',
        lastRunAt: Number(file?.lastRunAt) || null,
        counts: normalizeCounts(file?.counts),
    }
}

function normalizeStore(raw) {
    const files = {}
    for (const [id, file] of Object.entries(raw?.files || {})) {
        if (!id || !file) continue
        files[id] = normalizeFile(id, file)
    }
    return { version: 1, files }
}

export async function readImportsStore() {
    try {
        const raw = await fsp.readFile(IMPORTS_FILE, 'utf8')
        return normalizeStore(JSON.parse(raw))
    } catch (err) {
        if (err?.code !== 'ENOENT') {
            // Keep the unreadable file around for inspection instead of
            // letting the next write silently commit an empty store over it.
            console.error('import-files.json unreadable:', err.message)
            await fsp
                .rename(IMPORTS_FILE, `${IMPORTS_FILE}.corrupt-${Date.now()}`)
                .catch(() => null)
        }
        return normalizeStore({})
    }
}

async function writeImportsStore(next) {
    const normalized = normalizeStore(next)
    const tmpFile = `${IMPORTS_FILE}.tmp`
    await fsp.writeFile(tmpFile, JSON.stringify(normalized, null, 2), {
        mode: 0o600,
    })
    await fsp.rename(tmpFile, IMPORTS_FILE)
    return normalized
}

function withoutContent(file) {
    const { content, ...rest } = file
    return rest
}

export async function listImportFiles() {
    const store = await readImportsStore()
    return Object.values(store.files)
        .sort((a, b) => b.addedAt - a.addedAt)
        .map(withoutContent)
}

export async function getImportFile(id) {
    const store = await readImportsStore()
    return store.files[String(id || '')] || null
}

export async function addImportFile({ name, content, counts }) {
    return serialize(async () => {
        const store = await readImportsStore()
        const id = crypto.randomUUID()
        const file = normalizeFile(id, { name, content, counts, addedAt: Date.now(), lastRunAt: Date.now() })
        store.files[id] = file
        await writeImportsStore(store)
        return withoutContent(file)
    })
}

export async function saveImportFileRun(id, { counts }) {
    return serialize(async () => {
        const store = await readImportsStore()
        const file = store.files[String(id || '')]
        if (!file) return null
        file.counts = normalizeCounts(counts)
        file.lastRunAt = Date.now()
        await writeImportsStore(store)
        return withoutContent(file)
    })
}

export async function removeImportFile(id) {
    return serialize(async () => {
        const store = await readImportsStore()
        if (!store.files[String(id || '')]) return false
        delete store.files[String(id || '')]
        await writeImportsStore(store)
        return true
    })
}
