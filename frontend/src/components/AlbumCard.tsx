import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { api, artworkSrcSet, artworkUrl, type Album } from '../api/client'
import { stripYear } from '../lib/format'
import { cx } from '../lib/cx'
import { useAppSettings } from '../hooks/useAppSettings'
import { useDownloadQualityPrompt } from '../hooks/useDownloadQualityPrompt'
import { useLibraryPresence } from '../hooks/useLibraryPresence'
import { useQueue } from '../hooks/useQueue'
import { useTouchMode } from '../hooks/useTouchMode'
import { DownloadButton } from './DownloadButton'
import { ResolvedMediaLink } from './ResolvedMediaLink'

type Props = {
  album: Album
  size?: 'sm' | 'md'
  alreadyInLibrary?: boolean
}

export function AlbumCard({ album, size = 'md', alreadyInLibrary = false }: Props) {
  const { t } = useTranslation()
  const { jobs } = useQueue()
  const { ready, isAlbumInLibrary, verifyAlbumPresence, getAlbumTrackPresence } = useLibraryPresence()
  const touchMode = useTouchMode()
  const appSettings = useAppSettings()
  const { chooseDownloadQuality, qualityPrompt } = useDownloadQualityPrompt()
  const showRatingBadge =
    appSettings?.explicitFilter === 'both' &&
    (album.contentRating === 'explicit' || album.contentRating === 'clean')
  const trackPresence = getAlbumTrackPresence(album.id)
  const partial = Boolean(
    trackPresence &&
      trackPresence.expected > 0 &&
      trackPresence.present > 0 &&
      trackPresence.present < trackPresence.expected,
  )
  const fullByTracks = Boolean(trackPresence?.complete)
  const blocked = alreadyInLibrary || fullByTracks || (!trackPresence && isAlbumInLibrary(album))
  const matching = useMemo(() => {
    const active = jobs.find(
      (j) =>
        j.albumId === album.id &&
        (j.status === 'queued' || j.status === 'running'),
    )
    if (active) return active
    if (blocked) return jobs.find((j) => j.albumId === album.id) || null
    return null
  }, [jobs, album.id, blocked])
  const busyOrDone =
    (!!matching &&
      (matching.status === 'running' ||
        matching.status === 'queued' ||
        matching.status === 'done'))
  const thumb = artworkUrl(album.artworkTemplate, size === 'sm' ? 300 : 600)
  return (
    <div className="group relative flex min-w-0 flex-col">
      <div className="plate relative aspect-square w-full overflow-hidden rounded-card">
        <Link to={`/album/${album.id}`} className="block h-full w-full">
          {thumb ? (
            <img
              src={thumb}
              srcSet={artworkSrcSet(album.artworkTemplate)}
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 300px"
              loading="lazy"
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-3xl">
              ♪
            </div>
          )}
          {(blocked || partial || showRatingBadge) && (
            <div className="absolute top-2 left-2 z-10 flex flex-col items-start gap-1">
              {blocked && (
                <div className="rounded-full border-hair border-[var(--hair)] bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-white">
                  {t('albumCard.inLibrary')}
                </div>
              )}
              {partial && !blocked && (
                <div
                  className="rounded-full border-hair border-[var(--hair)] bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-white"
                  title={t('albumCard.tracksDownloaded', {
                    present: trackPresence?.present || 0,
                    expected: trackPresence?.expected || 0,
                  })}
                >
                  {t('albumCard.partial')}
                </div>
              )}
              {showRatingBadge && album.contentRating === 'explicit' && (
                <div
                  className="rounded-full border-hair border-[var(--hair)] bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-white"
                  title={t('albumCard.explicit')}
                >
                  E
                </div>
              )}
              {showRatingBadge && album.contentRating === 'clean' && (
                <div
                  className="rounded-full border-hair border-[var(--hair)] bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-white"
                  title={t('albumCard.clean')}
                >
                  {t('albumCard.clean')}
                </div>
              )}
            </div>
          )}
        </Link>
        <div className="absolute top-2 right-2 z-10">
          <DownloadButton
            job={matching}
            onStart={async () => {
              if (!ready && (await verifyAlbumPresence(album))) return false
              try {
                const quality = await chooseDownloadQuality()
                if (quality === false) return false
                await api.enqueue(album.id, quality)
                return true
              } catch (err: any) {
                if (/already in library/i.test(String(err?.message || ''))) {
                  await verifyAlbumPresence(album)
                  return false
                }
                throw err
              }
            }}
            ariaLabel={t('albumCard.download', { name: album.name })}
            blocked={blocked}
            className={cx(
              busyOrDone || touchMode
                ? 'opacity-100'
                : 'opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 transition-opacity duration-200',
            )}
          />
          {qualityPrompt}
        </div>
      </div>
      <div className="pt-2">
        <div className="truncate text-sm font-medium leading-[19px] text-white">
          <Link to={`/album/${album.id}`}>
            {stripYear(album.name)}
          </Link>
        </div>
        <div className="truncate text-[12.5px] leading-4 text-quiet">
          <ResolvedMediaLink
            kind="artist"
            artistId={album.artistId}
            artistName={album.artistName}
            className="transition-colors hover:text-white"
          >
            {album.artistName}
          </ResolvedMediaLink>
          {album.year ? ` · ${album.year}` : ''}
        </div>
      </div>
    </div>
  )
}
