import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import {
  Clock as Clock3,
  Hd as BadgeIcon,
  Download,
  Playlist as ListMusic,
  PlaylistPlus as ListPlus,
  MinusCircle as ListX,
  Xmark as X,
} from 'iconoir-react'
import { useTranslation } from 'react-i18next'

import {
  api,
  artworkSrcSet,
  artworkUrl,
  type FollowedPlaylist,
  type LibraryPlaylistDetail,
  type PlaylistDetail,
  type QualityPreference,
} from '../api/client'
import { useDownloadQualityPrompt } from '../hooks/useDownloadQualityPrompt'
import { useQueue } from '../hooks/useQueue'
import { useActivityFeed } from '../hooks/useActivityFeed'
import { useAppSettings } from '../hooks/useAppSettings'
import { AdmChip } from '../components/AdmChip'
import { Badge } from '../components/Badge'
import { ResolvedMediaLink } from '../components/ResolvedMediaLink'
import { formatPercent } from '../lib/format'
import { CoverWash } from '../components/CoverWash'
import { ProgressBar } from '../components/ProgressBar'
import { Button } from '../components/Button'
import { Modal } from '../components/Modal'
import { QualityPicker } from '../components/QualityPicker'

type AnyPlaylist =
  | (PlaylistDetail & { libraryId?: undefined; isUserCreated?: undefined; undownloadableCount?: undefined })
  | (LibraryPlaylistDetail & { url?: undefined; lastModifiedDate?: undefined })

function formatDur(ms: number | undefined) {
  if (!ms || !Number.isFinite(ms)) return '—'
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function PlaylistPage() {
  const { t } = useTranslation()
  const params = useParams<{ id?: string; libraryId?: string }>()
  const libraryId = params.libraryId || null
  const catalogId = libraryId ? null : params.id || null
  const [playlist, setPlaylist] = useState<AnyPlaylist | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [enqueueing, setEnqueueing] = useState(false)
  const [followed, setFollowed] = useState<FollowedPlaylist | null>(null)
  const [followModalOpen, setFollowModalOpen] = useState(false)
  const [unfollowModalOpen, setUnfollowModalOpen] = useState(false)
  const [followSubmitting, setFollowSubmitting] = useState(false)
  const [followQueuedCount, setFollowQueuedCount] = useState(0)
  const [followBanner, setFollowBanner] = useState<null | 'followed' | 'unfollowed'>(null)
  const [followQuality, setFollowQuality] = useState<QualityPreference>('flac')
  const { jobs } = useQueue()
  const { chooseDownloadQuality, qualityPrompt } = useDownloadQualityPrompt()
  const { playlistFollowingState } = useActivityFeed()
  const appSettings = useAppSettings()
  const bannerTimersRef = useRef<number[]>([])
  const pageId = libraryId || catalogId

  const clearBannerTimers = () => {
    for (const t of bannerTimersRef.current) window.clearTimeout(t)
    bannerTimersRef.current = []
  }
  useEffect(() => clearBannerTimers, [])

  useEffect(() => {
    if (!pageId) return
    let cancelled = false
    api
      .followedPlaylist(pageId)
      .then((r) => {
        if (!cancelled) setFollowed(r.playlist)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [pageId, playlist])

  const livePlaylistState = followed
    ? playlistFollowingState[followed.id]
    : pageId
      ? playlistFollowingState[pageId]
      : undefined
  useEffect(() => {
    if (livePlaylistState?.unfollowed) setFollowed(null)
  }, [livePlaylistState?.unfollowed])

  const existingPlaylistJob = useMemo(
    () =>
      jobs.find(
        (j) =>
          j.kind === 'playlist' &&
          ((libraryId && j.libraryPlaylistId === libraryId) ||
            (catalogId && j.playlistId === catalogId)) &&
          (j.status === 'queued' || j.status === 'running'),
      ) ||
      jobs.find(
        (j) =>
          j.kind === 'playlist' &&
          ((libraryId && j.libraryPlaylistId === libraryId) ||
            (catalogId && j.playlistId === catalogId)) &&
          j.status === 'done',
      ),
    [jobs, catalogId, libraryId],
  )

  useEffect(() => {
    let cancelled = false
    if (!libraryId && !catalogId) return
    const loader = libraryId ? api.libraryPlaylist(libraryId) : api.playlist(catalogId!)
    loader
      .then((r) => {
        if (!cancelled) setPlaylist(r.playlist as AnyPlaylist)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || t('playlist.failedToLoad'))
      })
    return () => {
      cancelled = true
    }
  }, [catalogId, libraryId])

  const coverBig = artworkUrl(playlist?.artworkTemplate, 600)

  const activePlaylistTrackJobs = useMemo(
    () =>
      jobs.filter(
        (j) =>
          j.kind === 'song' &&
          playlist?.tracks.some((track) => track.id === j.songId) &&
          (j.status === 'queued' || j.status === 'running'),
      ),
    [jobs, playlist],
  )

  const onDownload = async () => {
    if (!playlist) return
    setEnqueueing(true)
    try {
      const quality = await chooseDownloadQuality()
      if (quality === false) return
      if (libraryId) {
        await api.enqueueLibraryPlaylist(libraryId, undefined, quality)
      } else if (catalogId) {
        await api.enqueuePlaylist(catalogId, undefined, quality)
      }
    } catch (err: any) {
      setError(err?.message || t('playlist.enqueueFailed'))
    } finally {
      setEnqueueing(false)
    }
  }

  const isLibraryMode = Boolean(libraryId)

  const openFollowModal = () => {
    setFollowQuality(appSettings?.quality || 'flac')
    setFollowModalOpen(true)
  }

  const submitFollow = async (downloadNow: boolean) => {
    if (!pageId) return
    setFollowSubmitting(true)
    try {
      const quality = appSettings?.promptForDownloadQuality
        ? followQuality
        : undefined
      const result = libraryId
        ? await api.followLibraryPlaylist(libraryId, downloadNow, quality)
        : await api.followCatalogPlaylist(catalogId!, downloadNow, quality)
      setFollowed(result.playlist)
      setFollowModalOpen(false)
      setFollowBanner('followed')
      if (downloadNow) {
        setFollowQueuedCount(result.queued)
      }
      clearBannerTimers()
      bannerTimersRef.current = [
        window.setTimeout(() => setFollowBanner(null), 6000),
        window.setTimeout(() => setFollowQueuedCount(0), 6000),
      ]
    } catch (err: any) {
      setError(err?.message || t('playlist.failedToFollow'))
    } finally {
      setFollowSubmitting(false)
    }
  }

  const submitUnfollow = async () => {
    if (!followed) return
    setFollowSubmitting(true)
    try {
      await api.unfollowPlaylist(followed.id)
      setFollowed(null)
      setUnfollowModalOpen(false)
      setFollowBanner('unfollowed')
      setFollowQueuedCount(0)
      clearBannerTimers()
      bannerTimersRef.current = [
        window.setTimeout(() => setFollowBanner(null), 6000),
      ]
    } catch (err: any) {
      setError(err?.message || t('playlist.failedToUnfollow'))
    } finally {
      setFollowSubmitting(false)
    }
  }

  const undownloadable = isLibraryMode
    ? (playlist as LibraryPlaylistDetail | null)?.undownloadableCount || 0
    : 0
  const isUserCreated = isLibraryMode
    ? Boolean((playlist as LibraryPlaylistDetail | null)?.isUserCreated)
    : false
  const downloadable = isLibraryMode
    ? Boolean((playlist as LibraryPlaylistDetail | null)?.downloadable)
    : true

  return (
    <div className="w-full">
      <CoverWash template={playlist?.artworkTemplate} />
      {error && <Badge variant="bad">{error}</Badge>}

      <div className="messages">
      <AnimatePresence>
        {(followBanner || followQueuedCount > 0) && (
          <motion.div
            key="follow-banner"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            className="message"
          >
            <div>
              {followBanner === 'unfollowed'
                ? t('playlist.unfollowedBanner')
                : t('playlist.followedBanner')}{' '}
              {followQueuedCount > 0 && (
                <>
                  {t('playlist.queuedTracksForDownload', { count: followQueuedCount })}{' '}
                </>
              )}
              {followBanner !== 'unfollowed' && (
                <Link
                  to="/following"
                >
                  {t('playlist.openFollowing')}
                </Link>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                setFollowBanner(null)
                setFollowQueuedCount(0)
              }}
              aria-label={t('playlist.dismiss')}
              className="glyph h-9 w-9"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      </div>

      {playlist && (
        <>
          <div className="mb-[26px] flex flex-col items-center gap-[18px] text-center md:flex-row md:items-stretch md:gap-7 md:text-left">
            <div className="plate aspect-square w-[min(260px,70vw)] shrink-0 overflow-hidden rounded-cover md:w-[250px]">
              {coverBig ? (
                <img
                  src={coverBig}
                  srcSet={artworkSrcSet(playlist.artworkTemplate)}
                  sizes="(max-width: 768px) 70vw, 240px"
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center text-5xl">♫</div>
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1 self-stretch md:pt-14">
              <h1 className="text-[27px] leading-[1.15] md:text-[34px]">{playlist.name}</h1>
              <div className="text-[17px] font-medium text-quiet md:text-xl">{playlist.curatorName}</div>
              {playlist.description && (
                <p className="mt-1 line-clamp-3 text-[13px] text-quiet">{playlist.description}</p>
              )}
              {(existingPlaylistJob?.status === 'queued' ||
                existingPlaylistJob?.status === 'running') && (
                <div className="mt-3">
                  <ProgressBar
                    value={existingPlaylistJob.progress}
                    label={`${formatPercent(existingPlaylistJob.progress)} · ${existingPlaylistJob.message || existingPlaylistJob.status}`}
                  />
                </div>
              )}
              <div className="mt-[18px] flex flex-wrap justify-center gap-2.5 md:mt-auto md:justify-start md:pt-[18px]">
                <Button
                  variant="primary"
                  onClick={onDownload}
                  disabled={
                    enqueueing ||
                    !downloadable ||
                    (existingPlaylistJob && existingPlaylistJob.status !== 'failed')
                  }
                  className="min-h-[46px] min-w-[150px] px-5 text-[15px]"
                >
                  <Download />
                  {existingPlaylistJob?.status === 'done'
                    ? t('playlist.alreadyImported')
                    : existingPlaylistJob?.status === 'queued'
                      ? t('playlist.queued')
                      : existingPlaylistJob?.status === 'running'
                        ? t('playlist.downloading')
                        : !downloadable
                          ? t('playlist.noDownloadableTracks')
                          : t('playlist.downloadPlaylist')}
                </Button>
                {followed ? (
                  <Button
                    onClick={() => setUnfollowModalOpen(true)}
                    disabled={followSubmitting}
                    className="min-h-[46px] px-5 text-[15px]"
                  >
                    <ListX className="text-accent" />
                    {t('playlist.unfollow')}
                  </Button>
                ) : (
                  <Button
                    onClick={openFollowModal}
                    disabled={followSubmitting}
                    className="min-h-[46px] px-5 text-[15px]"
                  >
                    <ListPlus />
                    {t('playlist.follow')}
                  </Button>
                )}
              </div>
              {activePlaylistTrackJobs.length > 0 && (
                <div className="mt-3 text-[13px] text-quiet">
                  {t('playlist.tracksDownloading', { count: activePlaylistTrackJobs.length })}
                </div>
              )}
            </div>
          </div>

          {/* The list's head, as nori's: what it holds, a hairline under. */}
          <div className="caption flex min-h-12 items-center border-b border-[var(--hair)] px-2">
            <span>
              {[
                isUserCreated ? t('playlist.yourPlaylist') : t('playlist.playlist'),
                playlist.trackCount ? t('playlist.trackCount', { count: playlist.trackCount }) : null,
                playlist.hasHiRes ? t('playlist.hiResLossless') : playlist.hasLossless ? t('playlist.lossless') : null,
                playlist.hasAtmos ? t('playlist.dolbyAtmos') : null,
              ]
                .filter(Boolean)
                .join(' · ')}
              {undownloadable > 0 && (
                <span className="text-amber-500">
                  {' · '}
                  {t('playlist.notOnAppleMusic', { count: undownloadable })}
                </span>
              )}
            </span>
          </div>
          <div className="mt-1 grid min-h-7 grid-cols-[1.75rem_1fr_auto] items-center gap-x-3 px-2 text-xs font-semibold text-quiet md:grid-cols-[1.75rem_1fr_10rem_5rem]">
            <div className="text-right">#</div>
            <div>{t('playlist.title')}</div>
            <div className="hidden md:block">{t('playlist.artist')}</div>
            <div className="text-right"><Clock3 className="inline h-3.5 w-3.5" /></div>
          </div>
          <div className="rows [--row-text:48px]">
            {playlist.tracks.map((track, i) => {
              const matchingJob = jobs.find(
                (j) => j.songId === track.id && (j.status === 'queued' || j.status === 'running'),
              )
              return (
                <div
                  key={track.id}
                  className="grid min-h-[52px] grid-cols-[1.75rem_1fr_auto] items-center gap-x-3 px-2 py-1.5 transition-colors hover:bg-[var(--hover)] md:grid-cols-[1.75rem_1fr_10rem_5rem]"
                >
                  <div className="text-right text-[13px] text-quiet tabular-nums">{i + 1}</div>
                  <div className="min-w-0">
                    <div className="truncate text-base leading-[21px]">
                      {track.name}
                      {track.hasHiRes && (
                        <BadgeIcon className="ml-1.5 inline h-3.5 w-3.5 text-quiet" aria-label={t('playlist.hiRes')} />
                      )}
                      {track.isAppleDigitalMaster && <AdmChip />}
                    </div>
                    <div className="truncate text-[13px] text-quiet md:hidden">
                      <ResolvedMediaLink
                        kind="artist"
                        artistId={track.artistId}
                        artistName={track.artistName}
                        className="transition-colors hover:text-white"
                      >
                        {track.artistName}
                      </ResolvedMediaLink>
                      {track.albumName && ` · ${track.albumName}`}
                    </div>
                  </div>
                  <div className="hidden truncate text-quiet md:block">
                    <ResolvedMediaLink
                      kind="artist"
                      artistId={track.artistId}
                      artistName={track.artistName}
                      className="transition-colors hover:text-white"
                    >
                      {track.artistName}
                    </ResolvedMediaLink>
                  </div>
                  <div className="flex items-center justify-end gap-1.5 text-right text-[13px] text-quiet tabular-nums">
                    {matchingJob && (
                      <span className="text-[11px] font-semibold text-quiet">
                        {matchingJob.status === 'running'
                          ? `${formatPercent(matchingJob.progress)}`
                          : t('playlist.queued')}
                      </span>
                    )}
                    {formatDur(track.durationMs)}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
      {qualityPrompt}
      <Modal
        open={followModalOpen}
        onClose={() => setFollowModalOpen(false)}
        label={t('playlist.followPlaylist')}
        placement="center"
        className="!max-w-[40rem]"
      >
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center text-quiet">
              <ListMusic className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-quiet">
                {t('playlist.followPlaylist')}
              </div>
              <h2 className="mt-1 text-lg font-semibold text-white">
                {playlist?.name || t('playlist.playlist')}
              </h2>
              <p className="mt-2 text-sm text-quiet">
                {t('playlist.followModalDescription')}
              </p>
            </div>
          </div>
          {appSettings?.promptForDownloadQuality && (
            <div className="mt-5">
              <div className="mb-3">
                <div className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-quiet">
                  {t('playlist.downloadQuality')}
                </div>
                <div className="mt-1 text-sm text-quiet">
                  {t('playlist.appliesIfDownloadNow')}
                </div>
              </div>
              <QualityPicker value={followQuality} onChange={setFollowQuality} />
            </div>
          )}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              onClick={() => setFollowModalOpen(false)}
              disabled={followSubmitting}
              variant="ghost"
            >
              {t('playlist.cancel')}
            </Button>
            <Button
              onClick={() => submitFollow(false)}
              disabled={followSubmitting}
            >
              {t('playlist.futureAdditionsOnly')}
            </Button>
            <Button
              variant="primary"
              onClick={() => submitFollow(true)}
              disabled={followSubmitting}
            >
              {t('playlist.downloadExistingTracks')}
            </Button>
          </div>
        </div>
      </Modal>
      <Modal
        open={unfollowModalOpen}
        onClose={() => setUnfollowModalOpen(false)}
        label={t('playlist.unfollowPlaylist')}
        placement="center"
        className="!max-w-[36rem]"
      >
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center text-quiet">
              <ListX className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-quiet">
                {t('playlist.unfollowPlaylist')}
              </div>
              <h2 className="mt-1 text-lg font-semibold text-white">
                {playlist?.name || t('playlist.playlist')}
              </h2>
              <p className="mt-2 text-sm text-quiet">
                {t('playlist.unfollowModalDescription')}
              </p>
            </div>
          </div>
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              onClick={() => setUnfollowModalOpen(false)}
              disabled={followSubmitting}
              variant="ghost"
            >
              {t('playlist.cancel')}
            </Button>
            <Button
              onClick={submitUnfollow}
              disabled={followSubmitting}
              variant="ghost" className="!text-rose-500"
            >
              <ListX className="h-4 w-4" />
              {t('playlist.unfollow')}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
