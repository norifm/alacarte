import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useTranslation } from 'react-i18next'

import { api, artworkSrcSet, artworkUrl, type Playlist } from '../api/client'
import { cx } from '../lib/cx'
import { useDownloadQualityPrompt } from '../hooks/useDownloadQualityPrompt'
import { useLibraryPresence } from '../hooks/useLibraryPresence'
import { useQueue } from '../hooks/useQueue'
import { useTouchMode } from '../hooks/useTouchMode'
import { DownloadButton } from './DownloadButton'

type Props = {
  playlist: Playlist
  href?: string
  libraryId?: string | null
  userCreatedBadge?: boolean
}

export function PlaylistCard({ playlist, href, libraryId = null, userCreatedBadge = false }: Props) {
  const { t } = useTranslation()
  const { jobs } = useQueue()
  const { ready, isPlaylistInLibrary, verifyPlaylistPresence } = useLibraryPresence()
  const touchMode = useTouchMode()
  const { chooseDownloadQuality, qualityPrompt } = useDownloadQualityPrompt()
  const presenceLookup = libraryId ? { id: libraryId } : playlist
  const blocked = isPlaylistInLibrary(presenceLookup)
  const targetHref = href || `/playlist/${playlist.id}`
  const matching = useMemo(() => {
    const active = jobs.find(
      (j) =>
        j.kind === 'playlist' &&
        ((libraryId && j.libraryPlaylistId === libraryId) || j.playlistId === playlist.id) &&
        (j.status === 'queued' || j.status === 'running'),
    )
    if (active) return active
    if (blocked) {
      return (
        jobs.find(
          (j) =>
            j.kind === 'playlist' &&
            ((libraryId && j.libraryPlaylistId === libraryId) || j.playlistId === playlist.id),
        ) || null
      )
    }
    return null
  }, [jobs, playlist.id, libraryId, blocked])
  const busyOrDone =
    !!matching &&
    (matching.status === 'running' ||
      matching.status === 'queued' ||
      matching.status === 'done')

  const thumb = artworkUrl(playlist.artworkTemplate, 600)

  return (
    <div className="group relative flex min-w-0 flex-col">
      <div className="plate relative aspect-square w-full overflow-hidden rounded-card">
        <Link to={targetHref} className="block h-full w-full">
          {thumb ? (
            <img
              src={thumb}
              srcSet={artworkSrcSet(playlist.artworkTemplate)}
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 300px"
              loading="lazy"
              alt=""
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-3xl">
              ♫
            </div>
          )}
          {(blocked || userCreatedBadge) && (
            <div className="absolute top-2 left-2 z-10 flex flex-col items-start gap-1">
              {blocked && (
                <div className="rounded-full border-hair border-[var(--hair)] bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-white">
                  {t('playlistCard.inLibrary')}
                </div>
              )}
              {userCreatedBadge && !blocked && (
                <div className="rounded-full border-hair border-[var(--hair)] bg-surface px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] text-white">
                  {t('playlistCard.yours')}
                </div>
              )}
            </div>
          )}
        </Link>
        <div className="absolute top-2 right-2 z-10">
          <DownloadButton
            job={matching}
            onStart={async () => {
              if (!ready && (await verifyPlaylistPresence(presenceLookup))) return false
              try {
                const quality = await chooseDownloadQuality()
                if (quality === false) return false
                if (libraryId) {
                  await api.enqueueLibraryPlaylist(libraryId, undefined, quality)
                } else {
                  await api.enqueuePlaylist(playlist.id, undefined, quality)
                }
                return true
              } catch (err: any) {
                if (/already in library/i.test(String(err?.message || ''))) {
                  await verifyPlaylistPresence(presenceLookup)
                  return false
                }
                throw err
              }
            }}
            ariaLabel={t('playlistCard.download', { name: playlist.name })}
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
          <Link to={targetHref}>
            {playlist.name}
          </Link>
        </div>
        <div className="truncate text-[12.5px] leading-4 text-quiet">
          {playlist.curatorName}
          {typeof playlist.trackCount === 'number'
            ? ` · ${t('playlistCard.trackCount', { count: playlist.trackCount })}`
            : ''}
        </div>
      </div>
    </div>
  )
}
