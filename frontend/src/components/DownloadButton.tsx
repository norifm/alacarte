import { useEffect, useMemo, useState } from 'react'
import {
  Check,
  Download,
  RefreshDouble as Loader2,
  WarningCircle as AlertCircle,
} from 'iconoir-react'
import { useTranslation } from 'react-i18next'

import type { Job } from '../api/client'
import { cx } from '../lib/cx'

export type DownloadState = 'idle' | 'queued' | 'running' | 'done' | 'failed'

// Cancelled, or ended with nothing to download (e.g. not released yet):
// neither is shown as a failure.
function isCancelledJob(job: Job | null | undefined) {
  return Boolean(job?.cancelled || job?.unavailable || job?.error === 'Cancelled')
}

function stateFromJob(job: Job): DownloadState {
  if (isCancelledJob(job)) return 'idle'
  if (job.status === 'queued') return 'queued'
  if (job.status === 'running') return 'running'
  if (job.status === 'done') return 'done'
  if (job.status === 'failed') return 'failed'
  return 'idle'
}

type Props = {
  onStart: () => Promise<unknown>
  job?: Job | null
  size?: 'sm' | 'md'
  ariaLabel?: string
  className?: string
  blocked?: boolean
}
export function DownloadButton({
  onStart,
  job,
  size = 'md',
  ariaLabel,
  className = '',
  blocked = false,
}: Props) {
  const { t } = useTranslation()
  const [localState, setLocalState] = useState<DownloadState>('idle')
  const [error, setError] = useState<string | null>(null)
  const [ignoredFailedJobId, setIgnoredFailedJobId] = useState<string | null>(null)

  const state: DownloadState = useMemo(() => {
    if (job && !(job.status === 'failed' && job.id === ignoredFailedJobId)) {
      return stateFromJob(job)
    }
    return localState
  }, [ignoredFailedJobId, job, localState])

  useEffect(() => {
    if (!job) return
    if (job.id !== ignoredFailedJobId && job.status !== 'failed') {
      setIgnoredFailedJobId(null)
    }
    if (job.status !== 'queued' && job.status !== 'running') {
      setLocalState('idle')
      if (isCancelledJob(job)) setError(null)
    }
  }, [ignoredFailedJobId, job?.id, job?.status, job?.cancelled, job?.error])

  useEffect(() => {
    if (!job || job.status !== 'failed' || isCancelledJob(job) || job.id === ignoredFailedJobId) return
    setError(job.error || job.message || t('downloadButton.failed'))
    const timer = window.setTimeout(() => {
      setLocalState('idle')
      setError(null)
      setIgnoredFailedJobId(job.id)
    }, 3000)
    return () => window.clearTimeout(timer)
  }, [ignoredFailedJobId, job?.id, job?.status, job?.cancelled, job?.error, job?.message])

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (state === 'queued' || state === 'running') return
    if (blocked || state === 'done') return
    setLocalState('queued')
    setError(null)
    try {
      const started = await onStart()
      if (started === false) {
        setLocalState('idle')
      }
    } catch (err: any) {
      setLocalState('failed')
      setError(err?.message || t('downloadButton.failed'))
      setTimeout(() => {
        setLocalState('idle')
        setError(null)
      }, 3000)
    }
  }

  const Icon =
    blocked || state === 'done'
      ? Check
      : state === 'failed'
        ? AlertCircle
        : state === 'queued' || state === 'running'
          ? Loader2
          : Download

  const iconClass =
    !blocked && (state === 'queued' || state === 'running') ? 'animate-spin' : ''

  const title =
    blocked
      ? t('downloadButton.alreadyInLibrary')
      : state === 'done'
      ? t('downloadButton.downloaded')
      : state === 'failed'
        ? error || t('downloadButton.failed')
        : state === 'running'
          ? t('downloadButton.downloading')
          : state === 'queued'
            ? t('downloadButton.queued')
            : t('downloadButton.download')

  const progress = state === 'running' && job ? Math.min(100, Math.max(0, job.progress)) : null

  // On a cover (md) it floats on the chrome's glass; in a row (sm) it is a bare glyph. Quiet until it does
  // something: a download under way is the accent ("you, now"), one in the library the season's "on".
  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={!blocked && state === 'idle' ? ariaLabel ?? title : title}
      title={title}
      data-state={blocked ? 'blocked' : state}
      disabled={blocked || state === 'queued' || state === 'running'}
      className={cx(
        'glyph disabled:!opacity-100 disabled:cursor-default',
        size === 'sm' ? 'h-[34px] w-[34px] text-quiet' : 'chrome h-9 w-9 text-white',
        !blocked && state === 'idle' && 'hover:text-white',
        blocked || state === 'done'
          ? '!text-on'
          : state === 'queued' || state === 'running'
            ? '!text-accent'
            : state === 'failed'
              ? '!text-rose-500'
              : '',
        className,
      )}
    >
      {progress !== null ? (
        <ProgressRing
          percent={progress}
          size={size === 'sm' ? 28 : 32}
        />
      ) : null}
      <Icon
        className={`${iconClass} ${progress !== null ? '!absolute h-3.5 w-3.5' : 'h-[18px] w-[18px]'}`}
      />
    </button>
  )
}

function ProgressRing({ percent, size }: { percent: number; size: number }) {
  const stroke = 2
  const r = size / 2 - stroke
  const c = 2 * Math.PI * r
  const offset = c - (percent / 100) * c
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="!absolute"
      aria-hidden
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--seek-track)"
        strokeWidth={stroke}
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth={stroke}
        strokeDasharray={c}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="transition-[stroke-dashoffset] duration-300 ease-snappy"
      />
    </svg>
  )
}
