import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import {
  Xmark as X,
  CheckCircle as CheckCircle2,
  WarningCircle as AlertCircle,
  RefreshDouble as Loader2,
  Clock,
  Prohibition as CircleSlash,
  AlignTopBox as ArrowUpToLine,
  Calendar as CalendarClock,
} from 'iconoir-react'
import { useTranslation } from 'react-i18next'

import { api, type Job } from '../api/client'
import { stripYear, formatPercent } from '../lib/format'
import { ProgressBar } from './ProgressBar'
import { ResolvedMediaLink } from './ResolvedMediaLink'

type Props = {
  job: Job
  onMoveTop?: () => void
  dragHandle?: ReactNode
}

export function QueueItem({ job, onMoveTop, dragHandle }: Props) {
  const { t } = useTranslation()
  const cancelled = Boolean(job.cancelled || job.error === 'Cancelled')
  const unavailable = Boolean(job.unavailable)
  const StatusIcon =
    job.status === 'done'
      ? CheckCircle2
      : cancelled
        ? CircleSlash
        : unavailable
        ? CalendarClock
        : job.status === 'failed'
        ? AlertCircle
        : job.status === 'running'
          ? Loader2
          : Clock
  // A download under way is "you, now" (the accent); a failure the error color; the rest quiet.
  const statusColor =
    job.status === 'failed' && !cancelled && !unavailable
      ? 'text-rose-500'
      : job.status === 'running'
        ? 'text-accent'
        : 'text-quiet'
  const spin = job.status === 'running' ? 'animate-spin' : ''

  const onCancel = async () => {
    try {
      await api.cancel(job.id)
    } catch {}
  }

  const isPlaylist = job.kind === 'playlist'
  const playlistHref = job.playlistId
    ? `/playlist/${job.playlistId}`
    : job.libraryPlaylistId
      ? `/playlist/library/${job.libraryPlaylistId}`
      : null

  return (
    <div className="flex min-h-[68px] items-center gap-3 py-2.5 pl-2 pr-1 transition-colors hover:bg-[var(--hover)]">
      {dragHandle}
      <div className="plate h-12 w-12 shrink-0 overflow-hidden rounded-cover">
        {job.artworkUrl ? (
          <Link to={isPlaylist ? playlistHref || '/search' : `/album/${job.albumId}`} className="block h-full w-full">
            <img src={job.artworkUrl} alt="" className="h-full w-full object-cover" />
          </Link>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 min-w-0">
          <StatusIcon className={`h-4 w-4 shrink-0 ${statusColor} ${spin}`} />
          <div className="truncate text-base leading-[21px]">
            {isPlaylist && playlistHref ? (
              <Link to={playlistHref} className="hover:text-white transition-colors">
                {stripYear(job.albumTitle)}
              </Link>
            ) : (
              <ResolvedMediaLink
                kind="album"
                artistId={job.artistId}
                artistName={job.artist}
                albumId={job.albumId}
                albumName={job.albumTitle}
                className="hover:text-white transition-colors"
              >
                {stripYear(job.albumTitle)}
              </ResolvedMediaLink>
            )}{job.variant ? (
              <span className="opacity-60">
                {' · '}
                {job.variant === 'lossless'
                  ? t('queueItem.version', { format: job.quality === 'flac' ? 'FLAC' : 'ALAC' })
                  : t('queueItem.version', {
                      format: `${job.variant[0].toUpperCase()}${job.variant.slice(1)}`,
                    })}
              </span>
            ) : null}
          </div>
        </div>
        <div className="truncate text-[13px] text-quiet">
          <ResolvedMediaLink
            kind="artist"
            artistId={job.artistId}
            artistName={job.artist}
            className="hover:text-white transition-colors"
          >
            {job.artist}
          </ResolvedMediaLink>
          {job.status !== 'failed' && job.message
            ? ` · ${job.message}`
            : cancelled
              ? ` · ${t('queueItem.cancelled')}`
              : unavailable && job.message
                ? ` · ${job.message}`
                : ''}
        </div>
        {(job.status === 'running' || job.status === 'queued') && (
          <div className="mt-2"><ProgressBar value={job.progress} label={formatPercent(job.progress)} /></div>
        )}
        {job.status === 'failed' && !cancelled && !unavailable && (job.error || job.message) && (
          <div className="mt-0.5 truncate text-[13px] text-rose-500">{job.error || job.message}</div>
        )}
      </div>
      {onMoveTop && (
        <button
          type="button"
          onClick={onMoveTop}
          aria-label={t('queueItem.moveToTop')}
          title={t('queueItem.moveToTop')}
          className="glyph quiet h-10 w-10"
        >
          <ArrowUpToLine className="h-5 w-5" />
        </button>
      )}
      {(job.status === 'queued' || job.status === 'running') && (
        <button
          type="button"
          onClick={onCancel}
          aria-label={t('queueItem.cancel')}
          className="glyph quiet h-10 w-10"
        >
          <X className="h-5 w-5" />
        </button>
      )}
    </div>
  )
}
