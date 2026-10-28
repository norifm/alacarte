import { useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Download, Hd as BadgeIcon, Check } from 'iconoir-react'
import { useTranslation } from 'react-i18next'

import {
  api,
  artworkSrcSet,
  artworkUrl,
  type AlbumDetail,
  type Job,
  type QualityGroup,
  type QualityPreference,
} from '../api/client'
import { useLibraryPresence } from '../hooks/useLibraryPresence'
import { useDownloadQualityPrompt } from '../hooks/useDownloadQualityPrompt'
import { useQueue } from '../hooks/useQueue'
import { useTouchMode } from '../hooks/useTouchMode'
import { useAppSettings } from '../hooks/useAppSettings'
import { ProgressBar } from '../components/ProgressBar'
import { AdmChip, admDescription } from '../components/AdmChip'
import { Badge } from '../components/Badge'
import { Button } from '../components/Button'
import { DownloadButton } from '../components/DownloadButton'
import { ResolvedMediaLink } from '../components/ResolvedMediaLink'
import { stripYear, formatPercent } from '../lib/format'
import { CoverWash } from '../components/CoverWash'
import { cx } from '../lib/cx'

function formatDur(ms: number | undefined) {
  if (!ms || !Number.isFinite(ms)) return '—'
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function AlbumPage() {
  const { t, i18n } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const [album, setAlbum] = useState<AlbumDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [enqueueing, setEnqueueing] = useState(false)
  const {
    ready,
    isAlbumInLibrary,
    verifyAlbumPresence,
    verifyAlbumTracksPresence,
    getAlbumTrackPresence,
    getAlbumVersionGroups,
  } = useLibraryPresence()
  const { jobs } = useQueue()
  const touchMode = useTouchMode()
  const appSettings = useAppSettings()
  const { chooseDownloadQuality, qualityPrompt } = useDownloadQualityPrompt()

  const trackPresence = album ? getAlbumTrackPresence(album.id) : null
  const presentCount = trackPresence?.present ?? 0
  const expectedCount = trackPresence?.expected ?? album?.trackCount ?? album?.tracks?.length ?? 0
  const allPresent = trackPresence ? trackPresence.complete : false
  const partialState = trackPresence
    ? presentCount > 0 && presentCount < expectedCount
    : false
  // Tracks of a pre-release album that are not out yet cannot be filled in.
  const unreleasedMissing = (album?.tracks || []).filter(
    (tr) => tr.released === false && !trackPresence?.tracks?.[tr.id],
  ).length
  const missingCount = Math.max(0, expectedCount - presentCount - unreleasedMissing)
  const releaseDay = album?.releaseDate
    ? new Date(`${String(album.releaseDate).slice(0, 10)}T00:00:00Z`).toLocaleDateString(i18n.language, {
        day: 'numeric',
        month: 'short',
        timeZone: 'UTC',
      })
    : null
  const nothingOutYet = unreleasedMissing > 0 && missingCount === 0

  const existingJob: Job | undefined = useMemo(
    () =>
      jobs.find(
        (j) =>
          j.albumId === id &&
          j.kind === 'album' &&
          (j.status === 'queued' || j.status === 'running'),
      ) || ((album && isAlbumInLibrary(album)) ? jobs.find((j) => j.albumId === id && j.kind === 'album' && j.status === 'done') : undefined),
    [jobs, id, album, isAlbumInLibrary],
  )

  useEffect(() => {
    let cancelled = false
    if (!id) return
    api
      .album(id)
      .then((r) => {
        if (!cancelled) {
          setAlbum(r.album)
          verifyAlbumPresence(r.album, true)
          if (r.album?.tracks?.length) {
            verifyAlbumTracksPresence(
              {
                id: r.album.id,
                artistName: r.album.artistName,
                name: r.album.name,
                tracks: r.album.tracks.map((tr) => ({ id: tr.id, name: tr.name, isrc: tr.isrc })),
              },
              true,
            )
          }
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err.message || t('album.loadError'))
        }
      })
    return () => {
      cancelled = true
    }
  }, [id, verifyAlbumPresence, verifyAlbumTracksPresence])

  useEffect(() => {
    if (!album?.tracks?.length) return
    if (ready && !trackPresence) {
      verifyAlbumTracksPresence(
        {
          id: album.id,
          artistName: album.artistName,
          name: album.name,
          tracks: album.tracks.map((tr) => ({ id: tr.id, name: tr.name, isrc: tr.isrc })),
        },
        false,
      )
    }
  }, [album, ready, trackPresence, verifyAlbumTracksPresence])

  const onDownload = async () => {
    if (!album) return
    setEnqueueing(true)
    try {
      if (!ready && (await verifyAlbumPresence(album))) return
      const quality = await chooseDownloadQuality()
      if (quality === false) return
      await api.enqueue(album.id, quality)
    } catch (err: any) {
      if (/already in library/i.test(String(err?.message || ''))) {
        await verifyAlbumPresence(album)
        return
      }
      setError(err?.message || t('album.enqueueFailed'))
    } finally {
      setEnqueueing(false)
    }
  }

  const coverBig = artworkUrl(album?.artworkTemplate, 600)
  const primaryArtistId = album?.artistId || album?.artists?.[0]?.id || null
  const alreadyInLibrary = allPresent || (!trackPresence && album ? isAlbumInLibrary(album) : false)
  const presentGroups = useMemo(
    () => (album && alreadyInLibrary ? getAlbumVersionGroups(album) : []),
    [album, alreadyInLibrary, getAlbumVersionGroups],
  )
  const missingVariants = useMemo(() => {
    if (!appSettings?.versionOptionsEnabled || !album || !alreadyInLibrary) return []
    const offered = appSettings.versionOptions || []
    const options: Array<{ group: QualityGroup; quality?: QualityPreference; label: string }> = []
    if (offered.includes('atmos') && album.hasAtmos && !presentGroups.includes('atmos')) {
      options.push({ group: 'atmos', quality: 'atmos', label: t('album.getAtmosVersion') })
    }
    if (offered.includes('lossless') && !presentGroups.includes('lossless') && (album.hasLossless ?? true)) {
      options.push({ group: 'lossless', quality: 'flac', label: t('album.getLosslessVersion') })
    }
    if (offered.includes('aac') && !presentGroups.includes('aac')) {
      options.push({ group: 'aac', quality: 'aac', label: t('album.getAacVersion') })
    }
    return options
  }, [album, alreadyInLibrary, presentGroups, appSettings, t])
  const [variantEnqueueing, setVariantEnqueueing] = useState<string | null>(null)

  const onVariantDownload = async (label: string, run: () => Promise<unknown>) => {
    setVariantEnqueueing(label)
    try {
      await run()
    } catch (err: any) {
      if (!/already in library/i.test(String(err?.message || ''))) {
        setError(err?.message || t('album.enqueueFailed'))
      }
      await verifyAlbumPresence(album)
    } finally {
      setVariantEnqueueing(null)
    }
  }
  const downloadButtonLabel = enqueueing
    ? t('album.queueing')
    : alreadyInLibrary
    ? t('album.alreadyInLibrary')
    : existingJob?.status === 'done'
    ? t('album.alreadyImported')
    : existingJob?.status === 'queued'
    ? t('album.queued')
    : existingJob?.status === 'running'
    ? t('album.downloading')
    : nothingOutYet
    ? t('album.notOutYet', { date: releaseDay })
    : partialState && missingCount > 0
    ? t('album.fillMissingTracks', { count: missingCount })
    : t('album.download')

  // What the list holds, as small grey capitals under the title: "2019 · 12 SONGS · LOSSLESS".
  const caption = album
    ? [
        album.year,
        album.trackCount ? t('album.trackCount', { count: album.trackCount }) : null,
        album.hasHiRes ? t('album.hiResLossless') : album.hasLossless ? t('album.lossless') : null,
        album.isAppleDigitalMaster ? (
          <span key="adm" title={admDescription()}>
            {t('album.appleDigitalMaster')}
          </span>
        ) : null,
        album.hasAtmos ? t('album.dolbyAtmos') : null,
        album.contentRating === 'explicit' ? t('album.explicit') : album.contentRating === 'clean' ? t('album.clean') : null,
        ...album.genreNames.slice(0, 2),
      ].filter(Boolean)
    : []

  return (
    <div className="w-full">
      <CoverWash template={album?.artworkTemplate} />
      {error && <Badge variant="bad">{error}</Badge>}

      {album && (
        <>
          <div className="mb-[26px] flex flex-col items-center gap-[18px] text-center md:flex-row md:items-stretch md:gap-7 md:text-left">
            <div className="aspect-square w-[min(260px,70vw)] shrink-0 overflow-hidden rounded-cover plate md:w-[250px]">
              {coverBig && (
                <img
                  src={coverBig}
                  srcSet={artworkSrcSet(album.artworkTemplate)}
                  sizes="(max-width: 768px) 70vw, 240px"
                  alt=""
                  className="h-full w-full object-cover"
                  loading="eager"
                  decoding="async"
                  fetchPriority="high"
                />
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1 self-stretch md:pt-14">
              <h1 className="text-[27px] leading-[1.15] md:text-[34px]">{stripYear(album.name)}</h1>
              <div className="text-[17px] font-medium text-quiet md:text-xl">
                <ResolvedMediaLink
                  kind="artist"
                  artistId={primaryArtistId}
                  artistName={album.artistName}
                  className="transition-colors hover:text-white"
                >
                  {album.artistName}
                </ResolvedMediaLink>
              </div>
              {album.artists && album.artists.length > 1 && (
                <div className="flex flex-wrap justify-center gap-x-3 text-sm text-quiet md:justify-start">
                  {album.artists.map((a) => (
                    <Link key={a.id} to={`/artist/${a.id}`} className="transition-colors hover:text-white">
                      {a.name || album.artistName}
                    </Link>
                  ))}
                </div>
              )}

              <div className="mt-[18px] flex flex-col gap-3 md:mt-auto md:pt-[18px]">
                {existingJob &&
                  (existingJob.status === 'queued' || existingJob.status === 'running') && (
                    <ProgressBar
                      value={existingJob.progress}
                      label={`${formatPercent(existingJob.progress)} · ${existingJob.message || existingJob.status}`}
                    />
                  )}
                <div className="flex flex-wrap justify-center gap-2.5 md:justify-start">
                  <Button
                    variant="primary"
                    onClick={onDownload}
                    disabled={
                      enqueueing ||
                      alreadyInLibrary ||
                      nothingOutYet ||
                      (existingJob && existingJob.status !== 'failed')
                    }
                    className="min-h-[46px] min-w-[150px] px-5 text-[15px]"
                  >
                    {alreadyInLibrary ? <Check /> : <Download />}
                    {downloadButtonLabel}
                  </Button>
                  {missingVariants.map((option) => (
                    <Button
                      key={option.group}
                      onClick={() =>
                        onVariantDownload(option.label, async () => {
                          if (!ready && (await verifyAlbumPresence(album))) return
                          await api.enqueue(album.id, option.quality)
                        })
                      }
                      disabled={variantEnqueueing === option.label || existingJob?.status === 'running'}
                      className="min-h-[46px] px-5 text-[15px]"
                    >
                      {variantEnqueueing === option.label ? t('album.queueing') : option.label}
                    </Button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* The list's head, as nori's: what it holds, a hairline under. */}
          <div className="caption flex min-h-12 items-center border-b border-[var(--hair)] px-2">
            <span className="truncate">
              {caption.map((part, i) => (
                <span key={i}>
                  {i > 0 && ' · '}
                  {part}
                </span>
              ))}
            </span>
          </div>
          <div className="rows mt-1 [--row-text:48px]">
            {album.tracks.map((track) => {
              const tArtistId = track.artistName === album.artistName
                ? primaryArtistId
                : album.artists?.find(a => a.name === track.artistName)?.id
              const trackDownloaded = Boolean(trackPresence?.tracks?.[track.id])
              const notOut = track.released === false && !trackDownloaded
              const trackJob = trackDownloaded
                ? null
                : jobs.find(
                    (j) =>
                      (j.songId === track.id ||
                        (j.albumId === album.id && j.kind === 'album')) &&
                      (j.status === 'queued' || j.status === 'running'),
                  ) || null

              return (
              <div
                key={track.id}
                className="group/track grid min-h-[52px] grid-cols-[1.75rem_1fr_auto_2.25rem] items-center gap-x-3 py-1.5 pl-2 pr-1 transition-colors hover:bg-[var(--hover)] md:grid-cols-[1.75rem_1fr_10rem_5rem_2.25rem]"
              >
                <div className="text-right text-[13px] text-quiet tabular-nums">{track.trackNumber ?? '—'}</div>
                <div className={cx('min-w-0', notOut && 'opacity-50')}>
                  <div className="truncate text-base leading-[21px]">{track.name}</div>
                  <div className="truncate text-[13px] text-quiet md:hidden">
                    <ResolvedMediaLink
                      kind="artist"
                      artistId={tArtistId}
                      artistName={track.artistName}
                      className="transition-colors hover:text-white"
                    >
                      {track.artistName}
                    </ResolvedMediaLink>
                  </div>
                </div>
                <div className="hidden truncate text-quiet md:block">
                  <ResolvedMediaLink
                    kind="artist"
                    artistId={tArtistId}
                    artistName={track.artistName}
                    className="transition-colors hover:text-white"
                  >
                    {track.artistName}
                  </ResolvedMediaLink>
                </div>
                <div className="text-right text-[13px] text-quiet tabular-nums">
                  {formatDur(track.durationMs)}
                  {track.hasHiRes && (
                    <BadgeIcon className="ml-1.5 inline h-3.5 w-3.5" aria-label={t('album.hiRes')} />
                  )}
                  {track.isAppleDigitalMaster && !album.isAppleDigitalMaster && <AdmChip />}
                </div>
                <div className="flex items-center justify-end">
                  {notOut ? (
                    <span
                      className="whitespace-nowrap text-[11px] text-quiet"
                      title={t('album.trackNotOutYet', { date: releaseDay })}
                    >
                      {releaseDay}
                    </span>
                  ) : (
                  <DownloadButton
                    job={trackJob}
                    size="sm"
                    blocked={trackDownloaded}
                    ariaLabel={t('album.downloadTrack', { name: track.name })}
                    onStart={async () => {
                      try {
                        const quality = await chooseDownloadQuality()
                        if (quality === false) return false
                        await api.enqueueSong(track.id, album.id, undefined, quality)
                        return true
                      } catch (err: any) {
                        if (/already in library/i.test(String(err?.message || ''))) {
                          await verifyAlbumTracksPresence(
                            {
                              id: album.id,
                              artistName: album.artistName,
                              name: album.name,
                              tracks: album.tracks.map((x) => ({ id: x.id, name: x.name, isrc: x.isrc })),
                            },
                            true,
                          )
                          return false
                        }
                        throw err
                      }
                    }}
                    className={cx(
                      trackDownloaded || trackJob || touchMode
                        ? 'opacity-100'
                        : 'opacity-0 group-hover/track:opacity-100 focus-within:opacity-100 transition-opacity duration-200',
                    )}
                  />
                  )}
                </div>
              </div>
              )
            })}
          </div>
          {album.recordLabel && (
            <div className="mt-4 px-2 text-[13px] text-quiet">
              {album.recordLabel}
              {album.copyright ? ` · ${album.copyright}` : ''}
            </div>
          )}
        </>
      )}
      {qualityPrompt}
    </div>
  )
}
