import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import {
  Cloud,
  CloudDownload,
  CompactDisc as Disc3,
  Download,
  Playlist as ListMusic,
  RefreshDouble as Loader2,
  MusicNote as Music2,
  Refresh as RefreshCw,
  Xmark as X,
} from 'iconoir-react'

import {
  api,
  artworkUrl,
  type Album,
  type CloudLibraryAlbum,
  type CloudLibraryHealth,
  type CloudLibraryKind,
  type CloudLibraryPlaylist,
  type CloudLibrarySong,
  type Playlist,
  type QualityPreference,
  type Song,
} from '../api/client'
import { AlbumCard } from '../components/AlbumCard'
import { PlaylistCard } from '../components/PlaylistCard'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { PageTitle } from '../components/PageTitle'
import { Dots } from '../components/Dots'
import { DownloadButton } from '../components/DownloadButton'
import { Modal } from '../components/Modal'
import { QualityPicker } from '../components/QualityPicker'
import { StaggeredItem, StaggeredList } from '../components/StaggeredList'
import { useAppSettings } from '../hooks/useAppSettings'
import { useDownloadQualityPrompt } from '../hooks/useDownloadQualityPrompt'
import { useEventStream } from '../hooks/useEventStream'
import { useLibraryPresence } from '../hooks/useLibraryPresence'
import { useQueue } from '../hooks/useQueue'
import { cx } from '../lib/cx'

type TabKey = CloudLibraryKind
type AnyItem = CloudLibraryAlbum | CloudLibraryPlaylist | CloudLibrarySong

type TabState<T> = {
  items: T[]
  total: number | null
  next: number | null
  loading: boolean
  loadingMore: boolean
  error: string | null
}

type AllTabs = {
  albums: TabState<CloudLibraryAlbum>
  playlists: TabState<CloudLibraryPlaylist>
  songs: TabState<CloudLibrarySong>
}

const PAGE_SIZE = 100
const TAB_KEYS: readonly TabKey[] = ['albums', 'playlists', 'songs']

function isTabKey(value: string | null): value is TabKey {
  return value !== null && (TAB_KEYS as readonly string[]).includes(value)
}

function emptyTab<T>(): TabState<T> {
  return {
    items: [],
    total: null,
    next: 0,
    loading: false,
    loadingMore: false,
    error: null,
  }
}

const fetchers = {
  albums: api.cloudLibraryAlbums,
  playlists: api.cloudLibraryPlaylists,
  songs: api.cloudLibrarySongs,
}

type TFn = (key: string, opts?: Record<string, unknown>) => string

function kindLowerLabel(t: TFn, kind: TabKey) {
  return kind === 'albums'
    ? t('cloudLibrary.albumsLower')
    : kind === 'playlists'
      ? t('cloudLibrary.playlistsLower')
      : t('cloudLibrary.songsLower')
}

function kindSingularLabel(t: TFn, kind: TabKey) {
  return kind === 'albums'
    ? t('cloudLibrary.kindSingularAlbum')
    : kind === 'playlists'
      ? t('cloudLibrary.kindSingularPlaylist')
      : t('cloudLibrary.kindSingularSong')
}

export function CloudLibraryPage() {
  const { t } = useTranslation()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')
  const activeTab: TabKey = isTabKey(tabParam) ? tabParam : 'albums'
  const setActiveTab = useCallback(
    (tab: TabKey) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (tab === 'albums') next.delete('tab')
          else next.set('tab', tab)
          return next
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )
  const [health, setHealth] = useState<CloudLibraryHealth | null>(null)
  const [healthLoading, setHealthLoading] = useState(true)
  const [tabs, setTabs] = useState<AllTabs>({
    albums: emptyTab<CloudLibraryAlbum>(),
    playlists: emptyTab<CloudLibraryPlaylist>(),
    songs: emptyTab<CloudLibrarySong>(),
  })
  const [confirmKind, setConfirmKind] = useState<TabKey | null>(null)
  const [bulkRunning, setBulkRunning] = useState<TabKey | null>(null)
  const [bulkProgress, setBulkProgress] = useState<{
    kind: TabKey
    scanned: number
    queued: number
  } | null>(null)
  const [bulkBanner, setBulkBanner] = useState<{
    kind: TabKey
    queued: number
    skippedExisting: number
    unsupported: number
  } | null>(null)
  const appSettings = useAppSettings()
  const [bulkQuality, setBulkQuality] = useState<QualityPreference>('flac')

  const sentinelRef = useRef<HTMLDivElement | null>(null)
  const inFlightRef = useRef<Record<TabKey, Set<number>>>({
    albums: new Set(),
    playlists: new Set(),
    songs: new Set(),
  })

  const checkHealth = useCallback(async () => {
    setHealthLoading(true)
    try {
      const h = await api.cloudLibraryHealth()
      setHealth(h)
    } catch (err: any) {
      setHealth({ available: false, reason: 'probe-failed', error: err?.message })
    } finally {
      setHealthLoading(false)
    }
  }, [])

  useEffect(() => {
    checkHealth()
  }, [checkHealth])

  const loadPage = useCallback(
    async (kind: TabKey, mode: 'reset' | 'append') => {
      const fetcher = fetchers[kind] as (
        offset?: number,
        limit?: number,
      ) => Promise<{ items: AnyItem[]; next: number | null; total: number | null }>
      const offset = mode === 'reset' ? 0 : tabs[kind].next ?? 0
      const inflight = inFlightRef.current[kind]
      if (inflight.has(offset)) return
      inflight.add(offset)
      setTabs((prev) => ({
        ...prev,
        [kind]: {
          ...prev[kind],
          loading: mode === 'reset',
          loadingMore: mode === 'append',
          error: null,
        },
      }))
      try {
        const page = await fetcher(offset, PAGE_SIZE)
        setTabs((prev) => {
          const current = prev[kind]
          const merged =
            mode === 'reset' ? page.items : [...current.items, ...page.items]
          return {
            ...prev,
            [kind]: {
              items: merged as never,
              total: page.total,
              next: page.next,
              loading: false,
              loadingMore: false,
              error: null,
            },
          }
        })
      } catch (err: any) {
        setTabs((prev) => ({
          ...prev,
          [kind]: {
            ...prev[kind],
            loading: false,
            loadingMore: false,
            error: err?.message || t('cloudLibrary.failedToLoad'),
          },
        }))
      } finally {
        inflight.delete(offset)
      }
    },
    [tabs],
  )

  useEffect(() => {
    if (!health?.available) return
    const tab = tabs[activeTab]
    if (tab.items.length === 0 && !tab.loading && !tab.error) {
      loadPage(activeTab, 'reset')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, health?.available])

  useEffect(() => {
    const node = sentinelRef.current
    if (!node) return
    const tab = tabs[activeTab]
    if (tab.next === null || tab.loading || tab.loadingMore) return
    const obs = new IntersectionObserver((entries) => {
      const e = entries[0]
      if (e?.isIntersecting) {
        loadPage(activeTab, 'append')
      }
    }, { rootMargin: '300px' })
    obs.observe(node)
    return () => obs.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab, tabs[activeTab].next, tabs[activeTab].loading, tabs[activeTab].loadingMore])

  useEventStream((type, data) => {
    if (type !== 'cloud-library.download-all.progress') return
    const payload = data as {
      kind: TabKey
      scanned: number
      queued: number
      done: boolean
    }
    if (payload.done) {
      setBulkProgress(null)
      return
    }
    setBulkProgress({
      kind: payload.kind,
      scanned: payload.scanned,
      queued: payload.queued,
    })
  })

  const refresh = () => loadPage(activeTab, 'reset')

  useEffect(() => {
    if (confirmKind && appSettings?.quality) setBulkQuality(appSettings.quality)
  }, [confirmKind, appSettings?.quality])

  const startDownloadAll = async () => {
    if (!confirmKind) return
    const kind = confirmKind
    const quality = appSettings?.promptForDownloadQuality ? bulkQuality : undefined
    setConfirmKind(null)
    setBulkRunning(kind)
    setBulkBanner(null)
    try {
      const res = await api.cloudLibraryDownloadAll(kind, quality)
      setBulkBanner({
        kind,
        queued: res.queued,
        skippedExisting: res.skippedExisting,
        unsupported: res.unsupported,
      })
    } catch (err: any) {
      setTabs((prev) => ({
        ...prev,
        [kind]: { ...prev[kind], error: err?.message || t('cloudLibrary.bulkDownloadFailed') },
      }))
    } finally {
      setBulkRunning(null)
      setBulkProgress(null)
    }
  }

  if (healthLoading) {
    return (
      <div className="flex w-full justify-center py-16">
        <Dots />
      </div>
    )
  }

  if (!health?.available) {
    return <NotConnectedScreen reason={health?.reason} error={health?.error} onRetry={checkHealth} />
  }

  const activeState = tabs[activeTab]
  const hasItems = activeState.items.length > 0
  const neverFetched =
    activeState.total === null && activeState.items.length === 0 && !activeState.error
  const showSkeleton = (activeState.loading || neverFetched) && !hasItems
  const totalLabel = activeState.total !== null ? activeState.total : activeState.items.length

  return (
    <div className="flex w-full flex-col gap-[26px]">
      <div className="messages">
      <AnimatePresence>
        {bulkBanner && (
          <motion.div
            key="bulk-banner"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="message"
          >
            <div>
              {t('cloudLibrary.queuedPrefix')} <b>{bulkBanner.queued}</b> {kindLowerLabel(t, bulkBanner.kind)}.
              {bulkBanner.skippedExisting > 0 && (
                <span className="text-quiet"> · {t('cloudLibrary.alreadyInLibrary', { count: bulkBanner.skippedExisting })}</span>
              )}
              {bulkBanner.unsupported > 0 && (
                <span className="text-quiet"> · {t('cloudLibrary.notDownloadable', { count: bulkBanner.unsupported })}</span>
              )}{' '}
              <Link
                to="/"
              >
                {t('cloudLibrary.openActivity')}
              </Link>
            </div>
            <button
              type="button"
              onClick={() => setBulkBanner(null)}
              aria-label={t('cloudLibrary.dismissAriaLabel')}
              className="glyph h-9 w-9"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      </div>

      <PageTitle
        sub={
          <div className="flex flex-wrap gap-1" role="group" aria-label={t('cloudLibrary.librarySectionAriaLabel')}>
            <CatPill
              label={t('cloudLibrary.albumsLabel')}
              icon={Disc3}
              active={activeTab === 'albums'}
              onClick={() => setActiveTab('albums')}
              count={tabs.albums.total ?? tabs.albums.items.length}
            />
            <CatPill
              label={t('cloudLibrary.playlistsLabel')}
              icon={ListMusic}
              active={activeTab === 'playlists'}
              onClick={() => setActiveTab('playlists')}
              count={tabs.playlists.total ?? tabs.playlists.items.length}
            />
            <CatPill
              label={t('cloudLibrary.songsLabel')}
              icon={Music2}
              active={activeTab === 'songs'}
              onClick={() => setActiveTab('songs')}
              count={tabs.songs.total ?? tabs.songs.items.length}
            />
          </div>
        }
        aside={
          <>
          <Button onClick={refresh} disabled={activeState.loading} className="whitespace-nowrap">
            <RefreshCw className={activeState.loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
            {t('cloudLibrary.refresh')}
          </Button>
          {hasItems && (
            <Button
              disabled={Boolean(bulkRunning)}
              active={bulkRunning === activeTab}
              onClick={() => setConfirmKind(activeTab)}
              className="whitespace-nowrap"
            >
              {bulkRunning === activeTab ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {bulkProgress
                    ? t('cloudLibrary.queueingProgress', { queued: bulkProgress.queued, scanned: bulkProgress.scanned })
                    : t('cloudLibrary.queueing')}
                </>
              ) : (
                <>
                  <CloudDownload className="h-4 w-4" />
                  {t('cloudLibrary.downloadAll')}
                </>
              )}
            </Button>
          )}
          </>
        }
      >
        {t('cloudLibrary.pageTitle')}
      </PageTitle>

      {activeState.error && <Badge variant="bad">{activeState.error}</Badge>}

      {showSkeleton ? (
        activeTab === 'songs' ? <SongSkeletonList /> : <SkeletonGrid />
      ) : !hasItems ? (
        <div className="empty-note">
          <div className="flex max-w-md flex-col items-center gap-2">
            <div className="mb-2 grid h-16 w-16 place-items-center rounded-full bg-[var(--veil)] text-quiet [&_svg]:h-7 [&_svg]:w-7">
              <Cloud className="h-5 w-5" />
            </div>
            <h2 className="text-[19px] font-semibold tracking-[-0.2px] text-white">{t('cloudLibrary.emptyTitle')}</h2>
            <p className="text-sm text-quiet">
              {t('cloudLibrary.emptyBody', { kind: kindLowerLabel(t, activeTab) })}
            </p>
          </div>
        </div>
      ) : activeTab === 'albums' ? (
        <AlbumGrid items={tabs.albums.items} />
      ) : activeTab === 'playlists' ? (
        <PlaylistGrid items={tabs.playlists.items} />
      ) : (
        <SongList items={tabs.songs.items} />
      )}

      <div ref={sentinelRef} className="h-8 w-full" aria-hidden />
      {activeState.loadingMore && (
        <div className="flex justify-center py-4 text-xs text-quiet">
          <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
          {t('cloudLibrary.loadingMore')}
        </div>
      )}

      <Modal
        open={confirmKind !== null}
        onClose={() => setConfirmKind(null)}
        placement="center"
        label={t('cloudLibrary.confirmDownloadAllLabel')}
        className="!max-w-[26rem]"
      >
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center text-quiet"
              aria-hidden
            >
              <CloudDownload className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold text-white">
                {confirmKind ? t('cloudLibrary.downloadAllHeading', { kind: kindLowerLabel(t, confirmKind) }) : ''}
              </h2>
              <p className="mt-1 text-sm text-quiet">
                {t('cloudLibrary.confirmDescription', {
                  kind: confirmKind ? kindSingularLabel(t, confirmKind) : '',
                  itemsNote: totalLabel ? t('cloudLibrary.confirmItemsNote', { count: totalLabel }) : '',
                })}
              </p>
            </div>
          </div>
          {appSettings?.promptForDownloadQuality && (
            <div className="mt-5">
              <div className="mb-3">
                <div className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-quiet">{t('cloudLibrary.downloadQualityLabel')}</div>
                <div className="mt-1 text-sm text-quiet">
                  {t('cloudLibrary.downloadQualityHint')}
                </div>
              </div>
              <QualityPicker value={bulkQuality} onChange={setBulkQuality} />
            </div>
          )}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button onClick={() => setConfirmKind(null)} variant="ghost">
              {t('cloudLibrary.cancel')}
            </Button>
            <Button
              onClick={startDownloadAll}
              variant="primary"
            >
              <Download className="h-4 w-4" />
              {totalLabel ? t('cloudLibrary.queueCount', { count: totalLabel }) : t('cloudLibrary.queueAll')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}

function NotConnectedScreen({
  reason,
  error,
  onRetry,
}: {
  reason?: CloudLibraryHealth['reason']
  error?: string
  onRetry: () => void
}) {
  const { t } = useTranslation()
  const headline =
    reason === 'token-rejected'
      ? t('cloudLibrary.tokenRejectedHeadline')
      : reason === 'probe-failed'
        ? t('cloudLibrary.probeFailedHeadline')
        : t('cloudLibrary.connectAccountHeadline')
  const body =
    reason === 'token-rejected'
      ? t('cloudLibrary.tokenRejectedBody')
      : reason === 'probe-failed'
        ? error || t('cloudLibrary.probeFailedBody')
        : t('cloudLibrary.connectAccountBody')
  return (
    <div className="w-full">
      <div className="empty-note">
        <div className="flex max-w-md flex-col items-center gap-2">
          <div className="mb-2 grid h-16 w-16 place-items-center rounded-full bg-[var(--veil)] text-quiet [&_svg]:h-7 [&_svg]:w-7">
            <Cloud className="h-5 w-5" />
          </div>
          <h2 className="text-[19px] font-semibold tracking-[-0.2px] text-white">{headline}</h2>
          <p className="text-sm text-quiet">{body}</p>
          <div className="flex flex-wrap justify-center gap-2 pt-2">
            <Link
              to="/settings"
              className="pill small quiet"
            >
              {t('cloudLibrary.openSettings')}
            </Link>
            <Button onClick={onRetry} variant="ghost">
              <RefreshCw className="h-4 w-4" />
              {t('cloudLibrary.retry')}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

function CatPill({
  label,
  icon: Icon,
  active,
  onClick,
  count,
}: {
  label: string
  icon: React.ComponentType<{ className?: string }>
  active: boolean
  onClick: () => void
  count?: number | null
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cx(
        'chip select-none',
        active && 'on',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
      {typeof count === 'number' && count > 0 && (
        <span className="text-quiet text-[11px] font-normal">{count}</span>
      )}
    </button>
  )
}

// While the first page loads: still plates where the covers and rows will be; nothing pulses.
function SkeletonGrid() {
  return (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-3 gap-y-5 md:grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="plate aspect-square rounded-card" />
      ))}
    </div>
  )
}

function SongSkeletonList() {
  return (
    <div className="rows [--row-text:60px]">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="flex min-h-[60px] items-center gap-3 py-2 pl-2 pr-1">
          <div className="plate h-10 w-10 shrink-0 rounded-cover" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-3.5 w-[55%] rounded-full bg-[var(--veil)]" />
            <div className="h-3 w-[35%] rounded-full bg-[var(--veil)]" />
          </div>
        </div>
      ))}
    </div>
  )
}

function AlbumGrid({ items }: { items: CloudLibraryAlbum[] }) {
  return (
    <StaggeredList className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-3 gap-y-5 md:grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
      {items.map((it) => (
        <StaggeredItem key={it.libraryId}>
          <CloudAlbumTile item={it} />
        </StaggeredItem>
      ))}
    </StaggeredList>
  )
}

function CloudAlbumTile({ item }: { item: CloudLibraryAlbum }) {
  const { t } = useTranslation()
  const { isAlbumInLibrary } = useLibraryPresence()
  const localAlbum = { id: item.catalogId || item.libraryId, name: item.name, artistName: item.artistName }
  const alreadyInLibrary = isAlbumInLibrary(localAlbum)

  if (!item.catalogId) {
    return (
      <UnsupportedTile
        title={item.name}
        subtitle={item.artistName}
        artworkTemplate={item.artworkTemplate}
        kind={alreadyInLibrary ? t('cloudLibrary.inLibrary') : t('cloudLibrary.unavailable')}
        variant={alreadyInLibrary ? 'ok' : 'muted'}
      />
    )
  }

  const album: Album = {
    id: item.catalogId,
    name: item.name,
    artistName: item.artistName,
    artworkTemplate: item.artworkTemplate,
    artworkColor: item.artworkColor || null,
    trackCount: item.trackCount,
  }

  return <AlbumCard album={album} alreadyInLibrary={alreadyInLibrary} />
}

function PlaylistGrid({ items }: { items: CloudLibraryPlaylist[] }) {
  return (
    <StaggeredList className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-3 gap-y-5 md:grid-cols-[repeat(auto-fill,minmax(170px,1fr))]">
      {items.map((it) => {
        const playlist: Playlist = {
          id: it.catalogId || it.libraryId,
          name: it.name,
          curatorName: it.curatorName,
          artworkTemplate: it.artworkTemplate,
          artworkColor: it.artworkColor || null,
          description: it.description,
        }
        const libraryHref = it.catalogId
          ? `/playlist/${it.catalogId}`
          : `/playlist/library/${it.libraryId}`
        return (
          <StaggeredItem key={it.libraryId}>
            <PlaylistCard
              playlist={playlist}
              href={libraryHref}
              libraryId={it.catalogId ? null : it.libraryId}
              userCreatedBadge={it.isUserCreated}
            />
          </StaggeredItem>
        )
      })}
    </StaggeredList>
  )
}

function SongList({ items }: { items: CloudLibrarySong[] }) {
  return (
    <StaggeredList className="rows [--row-text:60px]">
      {items.map((it) => (
        <StaggeredItem key={it.libraryId}>
          <CloudSongRow song={it} />
        </StaggeredItem>
      ))}
    </StaggeredList>
  )
}

function CloudSongRow({ song }: { song: CloudLibrarySong }) {
  const { t } = useTranslation()
  const { jobs } = useQueue()
  const { chooseDownloadQuality, qualityPrompt } = useDownloadQualityPrompt()
  const { isAlbumInLibrary, isSongInLibrary, verifySongPresence, verifyAlbumPresence, ready } =
    useLibraryPresence()
  const matching = useMemo(() => {
    if (!song.catalogId) return null
    return (
      jobs.find(
        (j) =>
          j.kind === 'song' &&
          j.songId === song.catalogId &&
          (j.status === 'queued' || j.status === 'running'),
      ) ||
      jobs.find((j) => j.kind === 'song' && j.songId === song.catalogId) ||
      null
    )
  }, [jobs, song.catalogId])

  const albumCatalog = song.catalogAlbumId
  const thumb = artworkUrl(song.artworkTemplate, 100)
  const songForLink: Song = {
    id: song.catalogId || song.libraryId,
    name: song.name,
    artistName: song.artistName,
    albumName: song.albumName,
    albumId: albumCatalog || null,
    artworkTemplate: song.artworkTemplate,
  }

  const songLookup = {
    id: song.catalogId || song.libraryId,
    name: song.name,
    artistName: song.artistName,
    albumName: song.albumName,
  }
  const albumLookup = song.albumName
    ? { id: albumCatalog || '', artistName: song.artistName, name: song.albumName }
    : null
  const alreadyInLibrary =
    isSongInLibrary(songLookup) || (albumLookup ? isAlbumInLibrary(albumLookup) : false)

  return (
    <div className="group relative flex min-h-[60px] items-center gap-3 py-2 pl-2 pr-1 transition-colors hover:bg-[var(--hover)]">
      <div className="plate relative h-10 w-10 shrink-0 overflow-hidden rounded-cover">
        {thumb && (
          <img src={thumb} alt="" className="h-full w-full object-cover" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-base leading-[21px]">
          {albumCatalog ? (
            <Link to={`/album/${albumCatalog}`} className="hover:text-white transition-colors">
              {songForLink.name}
            </Link>
          ) : (
            songForLink.name
          )}
        </div>
        <div className="truncate text-[13px] text-quiet">
          {song.artistName}
          {song.albumName ? ` · ${song.albumName}` : ''}
        </div>
      </div>
      {alreadyInLibrary ? (
        <div className="shrink-0 pr-1">
          <Badge variant="ok">{t('cloudLibrary.inLibraryLower')}</Badge>
        </div>
      ) : !song.catalogId ? (
        <div className="shrink-0 pr-1">
          <Badge variant="muted">{t('cloudLibrary.unavailable')}</Badge>
        </div>
      ) : (
        <div className="shrink-0 pr-1">
          <DownloadButton
            size="sm"
            job={matching}
            onStart={async () => {
              if (!ready) {
                if (await verifySongPresence(songLookup)) return false
                if (albumLookup && (await verifyAlbumPresence(albumLookup))) return false
              }
              try {
                const quality = await chooseDownloadQuality()
                if (quality === false) return false
                await api.enqueueSong(song.catalogId!, albumCatalog || null, undefined, quality)
                return true
              } catch (err: any) {
                if (/already in library/i.test(String(err?.message || ''))) return false
                throw err
              }
            }}
            ariaLabel={t('cloudLibrary.downloadAriaLabel', { name: song.name })}
          />
        </div>
      )}
      {qualityPrompt}
    </div>
  )
}

function UnsupportedTile({
  title,
  subtitle,
  artworkTemplate,
  kind,
  variant = 'muted',
}: {
  title: string
  subtitle: string
  artworkTemplate: string | null
  kind: string
  variant?: 'muted' | 'ok'
}) {
  const thumb = artworkUrl(artworkTemplate, 600)
  return (
    <div className={cx('group relative flex min-w-0 flex-col', variant === 'ok' ? '' : 'opacity-60')}>
      <div className="plate relative aspect-square w-full overflow-hidden rounded-card">
        {thumb ? (
          <img src={thumb} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-3xl">
            ♪
          </div>
        )}
        <div
          className={cx(
            'absolute left-2 top-2 rounded-full border-hair border-[var(--hair)] bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em]',
            variant === 'ok' ? 'text-on' : 'text-white',
          )}
        >
          {kind}
        </div>
      </div>
      <div className="pt-2">
        <div className="truncate text-sm font-medium leading-[19px] text-white">{title}</div>
        <div className="truncate text-[12.5px] leading-4 text-quiet">{subtitle}</div>
      </div>
    </div>
  )
}
