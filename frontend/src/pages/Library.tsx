import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CompactDisc as BookAudio,
  QuoteMessage as FileText,
  MusicNote as Music2,
  CompactDisc as Disc3,
  Refresh as RefreshCw,
  Trash as Trash2,
  WarningCircle as AlertCircle,
  Search,
  Filter as ListFilter,
  NumberedListLeft as ListOrdered,
} from 'iconoir-react'
import { useTranslation } from 'react-i18next'

import { api, type LibraryAlbum, type LibraryPlaylist, type LibrarySingle } from '../api/client'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { Modal } from '../components/Modal'
import { ResolvedMediaLink } from '../components/ResolvedMediaLink'
import { cx } from '../lib/cx'
import { StaggeredList } from '../components/StaggeredList'
import { PageTitle } from '../components/PageTitle'
import { Dots } from '../components/Dots'
import { useLibraryPresence } from '../hooks/useLibraryPresence'
import { motion, AnimatePresence } from 'framer-motion'

type BusyMap = Record<string, boolean>
type DeleteTarget =
  | { kind: 'album'; item: LibraryAlbum }
  | { kind: 'song'; item: LibrarySingle }
  | { kind: 'playlist'; item: LibraryPlaylist }
  | null

type LibrarySort = 'date-desc' | 'date-asc' | 'name' | 'artist'

function compareText(a: string, b: string) {
  return a.localeCompare(b, undefined, { sensitivity: 'base' })
}

function matchesQuery(query: string, ...fields: Array<string | undefined>) {
  if (!query) return true
  return fields.some((field) => String(field || '').toLowerCase().includes(query))
}

function compareLibraryItems(
  sortBy: LibrarySort,
  a: { name: string; artist: string; addedAt?: number },
  b: { name: string; artist: string; addedAt?: number },
) {
  if (sortBy === 'date-desc') {
    return (
      (b.addedAt || 0) - (a.addedAt || 0) ||
      compareText(a.artist, b.artist) ||
      compareText(a.name, b.name)
    )
  }
  if (sortBy === 'date-asc') {
    return (
      (a.addedAt || 0) - (b.addedAt || 0) ||
      compareText(a.artist, b.artist) ||
      compareText(a.name, b.name)
    )
  }
  if (sortBy === 'artist') {
    return compareText(a.artist, b.artist) || compareText(a.name, b.name)
  }
  return compareText(a.name, b.name) || compareText(a.artist, b.artist)
}

export function LibraryPage() {
  const { t } = useTranslation()
  const [albums, setAlbums] = useState<LibraryAlbum[]>([])
  const [singles, setSingles] = useState<LibrarySingle[]>([])
  const [playlists, setPlaylists] = useState<LibraryPlaylist[]>([])
  const [sortBy, setSortBy] = useState<LibrarySort>('date-desc')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<BusyMap>({})
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null)
  const { refreshLibraryPresence } = useLibraryPresence()

  const load = useCallback(async (syncPresence = false) => {
    setLoading(true)
    setError(null)
    try {
      const r = await api.library()
      setAlbums(r.albums)
      setSingles(r.singles)
      setPlaylists(r.playlists || [])
      if (syncPresence) await refreshLibraryPresence()
    } catch (err: any) {
      setError(err?.message || t('library.loadFailed'))
    } finally {
      setLoading(false)
    }
  }, [refreshLibraryPresence])

  useEffect(() => {
    load()
  }, [load])

  const totals = useMemo(
    () => ({
      albums: albums.length,
      singles: singles.length,
      playlists: playlists.length,
      lyrics: singles.filter((s) => s.hasLyrics).length,
    }),
    [albums, singles, playlists],
  )

  const normalizedQuery = useMemo(() => query.trim().toLowerCase(), [query])

  const visibleAlbums = useMemo(() => {
    const filtered = albums.filter((a) =>
      matchesQuery(normalizedQuery, a.albumName, a.artistName, a.relPath),
    )
    return [...filtered].sort((a, b) =>
      compareLibraryItems(
        sortBy,
        { name: a.albumName, artist: a.artistName, addedAt: a.addedAt },
        { name: b.albumName, artist: b.artistName, addedAt: b.addedAt },
      ),
    )
  }, [albums, normalizedQuery, sortBy])

  const visibleSingles = useMemo(() => {
    const filtered = singles.filter((s) =>
      matchesQuery(normalizedQuery, s.songName, s.artistName, s.relPath),
    )
    return [...filtered].sort((a, b) =>
      compareLibraryItems(
        sortBy,
        { name: a.songName, artist: a.artistName, addedAt: a.addedAt },
        { name: b.songName, artist: b.artistName, addedAt: b.addedAt },
      ),
    )
  }, [singles, normalizedQuery, sortBy])

  const visiblePlaylists = useMemo(() => {
    const filtered = playlists.filter((p) =>
      matchesQuery(
        normalizedQuery,
        p.playlistName,
        p.fileName,
        p.relPath,
        p.catalogPlaylistId ?? undefined,
        p.libraryPlaylistId ?? undefined,
      ),
    )
    return [...filtered].sort((a, b) =>
      compareLibraryItems(
        sortBy,
        {
          name: a.playlistName,
          artist: a.fileName,
          addedAt: a.addedAt,
        },
        {
          name: b.playlistName,
          artist: b.fileName,
          addedAt: b.addedAt,
        },
      ),
    )
  }, [playlists, normalizedQuery, sortBy])

  const removeSong = (item: LibrarySingle) => {
    setDeleteTarget({ kind: 'song', item })
  }

  const removeAlbum = (item: LibraryAlbum) => {
    setDeleteTarget({ kind: 'album', item })
  }

  const removePlaylist = (item: LibraryPlaylist) => {
    setDeleteTarget({ kind: 'playlist', item })
  }

  const closeDeleteModal = () => {
    setDeleteTarget(null)
  }

  const confirmDelete = () => {
    if (!deleteTarget) return

    const target = deleteTarget
    const targetId = target.item.id

    setError(null)
    setDeleteTarget(null)
    setBusy((prev) => ({ ...prev, [targetId]: true }))

    if (target.kind === 'album') {
      setAlbums((prev) => prev.filter((x) => x.id !== target.item.id))
    } else if (target.kind === 'song') {
      setSingles((prev) => prev.filter((x) => x.id !== target.item.id))
    } else {
      setPlaylists((prev) => prev.filter((x) => x.id !== target.item.id))
    }

    ;(async () => {
      try {
        if (target.kind === 'album') {
          await api.deleteLibraryAlbum(target.item.relPath)
        } else if (target.kind === 'song') {
          await api.deleteLibrarySong(target.item.relPath)
        } else {
          await api.deleteLibraryPlaylist(target.item.relPath)
        }
        await refreshLibraryPresence()
      } catch (err: any) {
        setError(err?.message || t('library.deleteFailed'))
        if (target.kind === 'album') {
          setAlbums((prev) =>
            prev.some((x) => x.id === target.item.id) ? prev : [...prev, target.item as LibraryAlbum],
          )
        } else if (target.kind === 'song') {
          setSingles((prev) =>
            prev.some((x) => x.id === target.item.id) ? prev : [...prev, target.item as LibrarySingle],
          )
        } else {
          setPlaylists((prev) =>
            prev.some((x) => x.id === target.item.id) ? prev : [...prev, target.item as LibraryPlaylist],
          )
        }
      } finally {
        setBusy((prev) => {
          const next = { ...prev }
          delete next[targetId]
          return next
        })
      }
    })()
  }

  return (
    <div className="flex w-full flex-col gap-[26px]">
      <header className="flex flex-col gap-[26px]">
        <PageTitle
          sub={
            <span className="caption">
              {t('library.albumCount', { count: totals.albums })} ·{' '}
              {t('library.playlistCount', { count: totals.playlists })} ·{' '}
              {t('library.singleCount', { count: totals.singles })}
            </span>
          }
          aside={
            <Button onClick={() => load(true)}>
              <RefreshCw /> {t('library.refresh')}
            </Button>
          }
        >
          {t('nav.downloads')}
        </PageTitle>

        <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-start">
          <div>
            <label htmlFor="library-filter" className="sr-only">
              {t('library.filterLabel')}
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3.5 top-1/2 h-[19px] w-[19px] -translate-y-1/2 text-quiet" />
              <input
                id="library-filter"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('library.filterPlaceholder')}
                className="field !pl-10 [&::-webkit-search-cancel-button]:hidden"
              />
            </div>
          </div>

          <div className="flex items-center gap-2 md:justify-end md:self-start">
            <label htmlFor="library-sort" className="sr-only">
              {t('library.sortLabel')}
            </label>
            <div className="relative min-w-[210px]">
              <ListFilter className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-quiet" />
              <select
                id="library-sort"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as LibrarySort)}
                className="field !pl-10 !pr-10"
              >
                <option value="date-desc">{t('library.sortDateNewest')}</option>
                <option value="date-asc">{t('library.sortDateOldest')}</option>
                <option value="name">{t('library.sortName')}</option>
                <option value="artist">{t('library.sortArtist')}</option>
              </select>
            </div>
          </div>
        </div>
      </header>

      {error && (
        <Badge variant="bad">
          <AlertCircle className="h-4 w-4" /> {error}
        </Badge>
      )}

      <AnimatePresence mode="wait">
        {loading ? (
          <motion.div
            key="loading"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            className="flex justify-center py-16"
          >
            <Dots />
          </motion.div>
        ) : (
          <motion.div
            key="content"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col gap-[26px]"
          >
            <section>
              <h2 className="section-title">
                <Disc3 /> {t('library.albums')}
              </h2>
              {albums.length === 0 ? (
                <p className="px-2 py-2 text-[15px] text-quiet">{t('library.noAlbumsFound')}</p>
              ) : visibleAlbums.length === 0 ? (
                <p className="px-2 py-2 text-[15px] text-quiet">{t('library.noAlbumsMatch')}</p>
              ) : (
                <StaggeredList className="rows [--row-text:60px]">
                  <AnimatePresence initial={false}>
                    {visibleAlbums.map((a) => (
                      <motion.div
                        key={a.id}
                        layout="position"
                        initial={{ opacity: 0, scale: 0.996 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.996 }}
                        transition={{
                          layout: { duration: 0.24, ease: [0.22, 1, 0.36, 1] },
                          opacity: { duration: 0.14, ease: 'easeOut' },
                          scale: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
                        }}
                      >
                      <div className="flex min-h-[60px] items-center gap-3 py-2 pl-2 pr-1 transition-colors hover:bg-[var(--hover)]">
                        <ResolvedMediaLink
                          kind="album"
                          artistId={a.artistId}
                          artistName={a.artistName}
                          albumName={a.albumName}
                          className="plate flex h-10 w-10 shrink-0 items-center justify-center rounded-cover"
                        >
                          <BookAudio className="h-5 w-5" />
                        </ResolvedMediaLink>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-base leading-[21px]">
                            <ResolvedMediaLink
                              kind="album"
                              artistId={a.artistId}
                              artistName={a.artistName}
                              albumName={a.albumName}
                              className="hover:text-white transition-colors"
                            >
                              {a.albumName}
                            </ResolvedMediaLink>
                          </div>
                          <div className="truncate text-[13px] text-quiet">
                            <ResolvedMediaLink
                              kind="artist"
                              artistId={a.artistId}
                              artistName={a.artistName}
                              className="hover:text-white transition-colors"
                            >
                              {a.artistName}
                            </ResolvedMediaLink>{' '}
                            ·{' '}
                            {a.hasLyrics && a.lyricsCount === a.trackCount
                              ? t('library.tracksWithLyrics', { count: a.trackCount })
                              : `${t('library.tracks', { count: a.trackCount })}${a.hasLyrics ? ` · ${t('library.withLyricsCount', { count: a.lyricsCount })}` : ''}`}
                          </div>
                        </div>
                        <Button variant="ghost" onClick={() => removeAlbum(a)} disabled={Boolean(busy[a.id])} className="!font-medium !text-quiet hover:!text-white">
                          <Trash2 />
                          {busy[a.id] ? t('library.deleting') : t('library.delete')}
                        </Button>
                      </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </StaggeredList>
              )}
            </section>

            <section>
              <h2 className="section-title">
                <ListOrdered /> {t('library.playlists')}
              </h2>
              {playlists.length === 0 ? (
                <p className="px-2 py-2 text-[15px] text-quiet">{t('library.noPlaylistsFound')}</p>
              ) : visiblePlaylists.length === 0 ? (
                <p className="px-2 py-2 text-[15px] text-quiet">{t('library.noPlaylistsMatch')}</p>
              ) : (
                <StaggeredList className="rows [--row-text:60px]">
                  <AnimatePresence initial={false}>
                    {visiblePlaylists.map((p) => (
                      <motion.div
                        key={p.id}
                        layout="position"
                        initial={{ opacity: 0, scale: 0.996 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.996 }}
                        transition={{
                          layout: { duration: 0.24, ease: [0.22, 1, 0.36, 1] },
                          opacity: { duration: 0.14, ease: 'easeOut' },
                          scale: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
                        }}
                      >
                        <div className="flex min-h-[60px] items-center gap-3 py-2 pl-2 pr-1 transition-colors hover:bg-[var(--hover)]">
                          <div className="plate flex h-10 w-10 shrink-0 items-center justify-center rounded-cover">
                            <ListOrdered className="h-5 w-5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="truncate text-base leading-[21px]">{p.playlistName}</div>
                            <div className="truncate text-[13px] text-quiet">
                              {t('library.entryCount', { count: p.trackCount })} · {p.fileName}
                            </div>
                          </div>
                          <Button variant="ghost" onClick={() => removePlaylist(p)} disabled={Boolean(busy[p.id])} className="!font-medium !text-quiet hover:!text-white">
                            <Trash2 />
                            {busy[p.id] ? t('library.deleting') : t('library.delete')}
                          </Button>
                        </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </StaggeredList>
              )}
            </section>

            <section>
              <h2 className="section-title">
                <Music2 /> {t('library.singles')}
              </h2>
              {singles.length === 0 ? (
                <p className="px-2 py-2 text-[15px] text-quiet">{t('library.noSinglesFound')}</p>
              ) : visibleSingles.length === 0 ? (
                <p className="px-2 py-2 text-[15px] text-quiet">{t('library.noSinglesMatch')}</p>
              ) : (
                <StaggeredList className="rows [--row-text:60px]">
                  <AnimatePresence initial={false}>
                    {visibleSingles.map((s) => (
                      <motion.div
                        key={s.id}
                        layout="position"
                        initial={{ opacity: 0, scale: 0.996 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.996 }}
                        transition={{
                          layout: { duration: 0.24, ease: [0.22, 1, 0.36, 1] },
                          opacity: { duration: 0.14, ease: 'easeOut' },
                          scale: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
                        }}
                      >
                      <div className="flex min-h-[60px] items-center gap-3 py-2 pl-2 pr-1 transition-colors hover:bg-[var(--hover)]">
                        <div className="plate flex h-10 w-10 shrink-0 items-center justify-center rounded-cover">
                          <Music2 className="h-5 w-5" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-base leading-[21px]">{s.songName}</div>
                          <div className="truncate text-[13px] text-quiet">
                            <ResolvedMediaLink
                              kind="artist"
                              artistId={s.artistId}
                              artistName={s.artistName}
                              className="hover:text-white transition-colors"
                            >
                              {s.artistName}
                            </ResolvedMediaLink>
                          </div>
                        </div>
                        <div
                          className={cx(
                            'inline-flex shrink-0 select-none items-center gap-1.5 px-2 text-[13px] font-medium',
                            s.hasLyrics ? 'text-white' : 'text-quiet',
                          )}
                          title={s.hasLyrics ? t('library.lyricsSidecarAvailable') : t('library.noLyricsSidecar')}
                        >
                          <FileText className="h-3.5 w-3.5" />
                          {s.hasLyrics ? t('library.lyrics') : t('library.noLyrics')}
                        </div>
                        <Button variant="ghost" onClick={() => removeSong(s)} disabled={Boolean(busy[s.id])} className="!font-medium !text-quiet hover:!text-white">
                          <Trash2 />
                          {busy[s.id] ? t('library.deleting') : t('library.delete')}
                        </Button>
                      </div>
                      </motion.div>
                    ))}
                  </AnimatePresence>
                </StaggeredList>
              )}
            </section>
          </motion.div>
        )}
      </AnimatePresence>

      <Modal
        open={Boolean(deleteTarget)}
        onClose={closeDeleteModal}
        className="max-w-md p-6"
        label={t('library.confirmDeleteLabel')}
        placement="center"
      >
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Badge variant="bad">
              <AlertCircle className="h-3.5 w-3.5" />
              {t('library.confirmDeleteBadge')}
            </Badge>
          </div>

          {deleteTarget?.kind === 'album' ? (
            <>
              <h3 className="text-lg font-semibold leading-tight">
                {t('library.deleteAlbumTitle', { name: deleteTarget.item.albumName })}
              </h3>
              <p className="text-sm text-quiet">
                {t('library.deleteAlbumBody', { artist: deleteTarget.item.artistName })}
              </p>
            </>
          ) : deleteTarget?.kind === 'song' ? (
            <>
              <h3 className="text-lg font-semibold leading-tight">
                {t('library.deleteSongTitle', { name: deleteTarget.item.songName })}
              </h3>
              <p className="text-sm text-quiet">
                {t('library.deleteSongBody')}
              </p>
            </>
          ) : deleteTarget?.kind === 'playlist' ? (
            <>
              <h3 className="text-lg font-semibold leading-tight">
                {t('library.deletePlaylistTitle', { name: deleteTarget.item.playlistName })}
              </h3>
              <p className="text-sm text-quiet">
                {t('library.deletePlaylistBody', { name: deleteTarget.item.playlistName })}
              </p>
            </>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button onClick={closeDeleteModal}>{t('library.cancel')}</Button>
            <Button
              onClick={confirmDelete}
              disabled={!deleteTarget}
              variant="ghost" className="!text-rose-500"
            >
              {t('library.delete')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
