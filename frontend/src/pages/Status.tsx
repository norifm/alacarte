import { useEffect, useMemo, useRef, useState } from 'react'
import {
  Activity,
  WarningCircle as AlertCircle,
  CheckCircle as CheckCircle2,
  RefreshDouble as Loader2,
  Refresh as RefreshCw,
} from 'iconoir-react'
import { useTranslation } from 'react-i18next'

import i18n from '../i18n'
import type { HealthReport } from '../api/client'
import { Badge } from '../components/Badge'
import { Card } from '../components/Card'
import { PageTitle } from '../components/PageTitle'
import { ProgressBar } from '../components/ProgressBar'
import { formatPercent } from '../lib/format'
import {
  useActivityFeed,
  type ActivityFeedItem,
  type ActivitySeverity,
  type ActivityTerminalLine,
} from '../hooks/useActivityFeed'
import { useHealth } from '../hooks/useHealth'

export function StatusPage() {
  const { t } = useTranslation()
  const { health, loading: healthLoading } = useHealth(10000)
  const {
    loading,
    streamStatus,
    feedItems,
    terminalLines,
    activeJobs,
    recentFailures,
    latestEventAt,
  } = useActivityFeed()
  const terminalRef = useRef<HTMLDivElement | null>(null)
  const [followLogs, setFollowLogs] = useState(true)

  useEffect(() => {
    const node = terminalRef.current
    if (!node || !followLogs) return
    node.scrollTop = node.scrollHeight
  }, [followLogs, terminalLines.length])

  const healthRows = useMemo(() => buildHealthRows(health), [health])

  const handleTerminalScroll = () => {
    const node = terminalRef.current
    if (!node) return
    const distanceFromBottom = node.scrollHeight - node.scrollTop - node.clientHeight
    setFollowLogs(distanceFromBottom < 48)
  }

  return (
    <div className="flex w-full flex-col gap-[26px]">
      <PageTitle>{t('status.title')}</PageTitle>

      <section className="grid gap-3 md:grid-cols-3">
        <MetricCard
          label={t('status.backendStream')}
          value={streamLabel(streamStatus)}
          detail={
            latestEventAt
              ? t('status.lastEvent', { time: formatRelativeTime(latestEventAt) })
              : t('status.noEventsYet')
          }
          tone={streamTone(streamStatus)}
          icon={
            streamStatus === 'open' ? CheckCircle2 : streamStatus === 'reconnecting' ? RefreshCw : Loader2
          }
          spin={streamStatus !== 'open'}
        />
        <MetricCard
          label={t('status.activeJobs')}
          value={String(activeJobs.length)}
          detail={
            activeJobs[0]?.message ||
            activeJobs[0]?.currentTrack ||
            (activeJobs.length > 0 ? t('status.downloadsRunning') : t('status.noActiveJobs'))
          }
          tone={activeJobs.length > 0 ? 'info' : 'success'}
          icon={activeJobs.length > 0 ? Loader2 : CheckCircle2}
          spin={activeJobs.length > 0}
        />
        <MetricCard
          label={t('status.recentFailures')}
          value={String(recentFailures.length)}
          detail={recentFailures[0]?.error || t('status.noRecentFailures')}
          tone={recentFailures.length > 0 ? 'error' : 'success'}
          icon={recentFailures.length > 0 ? AlertCircle : CheckCircle2}
        />
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="space-y-6">
          <div>
            <div className="group-label !mt-0 flex items-center gap-2">
              <Activity className="h-3.5 w-3.5" />
              {t('status.systemHealth')}
            </div>
            <div className="grouped">
              {healthLoading || !health ? (
                <div className="group-row text-quiet">{t('status.checkingSystemStatus')}</div>
              ) : (
                healthRows.map((row) => (
                  <div key={row.label} className="group-row justify-between">
                    <div className="flex min-w-0 items-center gap-3">
                      {row.ok ? (
                        <CheckCircle2 className="h-5 w-5 shrink-0 text-on" />
                      ) : (
                        <AlertCircle className="h-5 w-5 shrink-0 text-rose-500" />
                      )}
                      <span className="truncate">{row.label}</span>
                    </div>
                    {!row.ok && (
                      <span className="max-w-[48%] truncate text-right text-[13px] text-rose-500">
                        {row.hint || row.error || t('status.unavailable')}
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          <div>
            <div className="group-label flex items-center gap-2">
              <Loader2 className="h-3.5 w-3.5" />
              {t('status.activeWork')}
            </div>
            <div className="grouped">
              {loading ? (
                <div className="group-row text-quiet">{t('status.loadingRecentJobState')}</div>
              ) : activeJobs.length === 0 ? (
                <div className="group-row text-quiet">
                  {t('status.noActiveJobsPeriod')}
                </div>
              ) : (
                activeJobs.slice(0, 6).map((job) => (
                  <div
                    key={job.id}
                    className="group-row block py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate">
                          {job.artist} – {job.albumTitle}
                        </div>
                        <div className="truncate text-[13px] text-quiet">
                          {job.message || job.currentTrack || (job.status === 'queued' ? t('status.queued') : t('status.running'))}
                        </div>
                      </div>
                      <Badge variant={job.status === 'queued' ? 'warn' : 'accent'}>
                        {job.status === 'queued' ? t('status.queued') : t('status.running')}
                      </Badge>
                    </div>
                    <div className="mt-3">
                      <ProgressBar value={job.progress} label={formatPercent(job.progress)} />
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="section-title !mb-0">{t('status.activityFeed')}</h2>
              <Badge
                variant={feedItems[0]?.severity === 'error' ? 'bad' : 'accent'}
                className="whitespace-nowrap text-[0.6875rem] md:text-xs"
              >
                {t('status.eventCount', { count: feedItems.length })}
              </Badge>
            </div>

            {feedItems.length === 0 ? (
              <p className="px-2 py-2 text-[15px] text-quiet">
                {t('status.noActivityYet')}
              </p>
            ) : (
              <div className="rows [--row-text:26px]">
                {feedItems.map((item) => (
                  <FeedCard key={item.id} item={item} />
                ))}
              </div>
            )}
          </section>
        </div>

        <div className="self-start xl:sticky xl:top-24">
          <Card>
            <div className="border-b border-[var(--line)] px-3.5 py-2.5">
              <div className="flex min-h-9 items-center justify-between gap-3">
                <div className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-quiet">{t('status.backendLog')}</div>
                <div className="flex items-center gap-2">
                  {!followLogs && (
                    <button
                      type="button"
                      onClick={() => {
                        setFollowLogs(true)
                        if (terminalRef.current) {
                          terminalRef.current.scrollTop = terminalRef.current.scrollHeight
                        }
                      }}
                      className="chip on !h-8 !px-3 !text-xs"
                    >
                      <span className="md:hidden">{t('status.latest')}</span>
                      <span className="hidden md:inline">{t('status.jumpToLatest')}</span>
                    </button>
                  )}
                  <Badge variant={streamStatus === 'open' ? 'ok' : streamStatus === 'reconnecting' ? 'warn' : 'accent'}>
                    {streamLabel(streamStatus)}
                  </Badge>
                </div>
              </div>
            </div>

            <div
              ref={terminalRef}
              onScroll={handleTerminalScroll}
              className="h-[min(68vh,760px)] overflow-y-auto px-1.5 py-1.5 font-mono text-[12.5px] leading-5"
            >
              {terminalLines.length === 0 ? (
                <div className="flex h-full min-h-[320px] items-center justify-center px-6 text-center text-sm text-quiet">
                  {t('status.waitingForBackendEvents')}
                </div>
              ) : (
                <div>
                  {terminalLines.map((line) => (
                    <div
                      key={line.id}
                      className="rounded-[12px] px-2.5 py-1.5 transition-colors hover:bg-[var(--hover)]"
                    >
                      <div className="mb-0.5 flex items-center gap-2 font-sans text-[11px] font-semibold uppercase tracking-[0.06em] text-quiet">
                        <span>{formatClockTime(line.ts)}</span>
                        <span className={channelClassName(line)}>{line.channel}</span>
                        <span className={sourceClassName(line.source)}>{line.source}</span>
                      </div>
                      <div className={severityClassName(line.severity)}>{line.text}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </Card>
        </div>
      </section>
    </div>
  )
}

type MetricCardProps = {
  label: string
  value: string
  detail: string
  tone: ActivitySeverity | 'success'
  icon: React.ComponentType<{ className?: string }>
  spin?: boolean
}

function MetricCard({ label, value, detail, tone, icon: Icon, spin = false }: MetricCardProps) {
  return (
    <Card className="px-4 py-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-quiet">{label}</div>
          <div className="mt-1 text-2xl font-bold tracking-[-0.5px] text-white">
            {value}
          </div>
          <div className="mt-0.5 truncate text-[13px] text-quiet">{detail}</div>
        </div>
        <Icon className={`${metricIconClassName(tone)} ${spin ? 'animate-spin' : ''}`} />
      </div>
    </Card>
  )
}

function FeedCard({ item }: { item: ActivityFeedItem }) {
  return (
    <div className="px-2 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2.5">
            <span className={feedDotClassName(item.severity)} />
            <h3 className="truncate font-normal">{item.title}</h3>
          </div>
          {item.detail && (
            <div className="ml-[18px] mt-0.5 break-words text-[13px] text-quiet">{item.detail}</div>
          )}
          {(item.jobStatus === 'queued' || item.jobStatus === 'running') &&
            typeof item.progress === 'number' &&
            item.progress > 0 &&
            item.progress < 100 && (
            <div className="ml-[18px] mt-2 max-w-sm">
              <ProgressBar value={item.progress} label={formatPercent(item.progress)} />
            </div>
          )}
        </div>
        <div className="shrink-0 text-xs text-quiet tabular-nums">{formatRelativeTime(item.ts)}</div>
      </div>
    </div>
  )
}

function buildHealthRows(health: HealthReport | null) {
  if (!health) return []

  const wrapperAllDown =
    !health.wrapper.decrypt.ok &&
    !health.wrapper.m3u8.ok &&
    !health.wrapper.account.ok

  const items: Array<{ label: string; ok: boolean; error?: string | null; hint?: string }> = [
    {
      label: i18n.t('status.appleMusicToken'),
      ok: health.appleToken.ok,
      error: health.appleToken.error,
    },
  ]

  if (wrapperAllDown) {
    items.push({
      label: i18n.t('status.appleMusicWrapper'),
      ok: false,
      hint: i18n.t('status.wrapperOfflineHint'),
    })
  } else {
    items.push(
      {
        label: i18n.t('status.decryptionWrapper'),
        ok: health.wrapper.decrypt.ok,
        error: health.wrapper.decrypt.error,
      },
      {
        label: i18n.t('status.m3u8StreamService'),
        ok: health.wrapper.m3u8.ok,
        error: health.wrapper.m3u8.error,
      },
      {
        label: i18n.t('status.accountService'),
        ok: health.wrapper.account.ok,
        error: health.wrapper.account.error,
      },
    )
  }

  items.push({
    label: i18n.t('status.musicPath', { path: health.music.path }),
    ok: health.music.ok,
    error: health.music.error,
  })

  return items
}

function streamLabel(status: 'connecting' | 'open' | 'reconnecting') {
  if (status === 'open') return i18n.t('status.streamLive')
  if (status === 'reconnecting') return i18n.t('status.streamReconnecting')
  return i18n.t('status.streamConnecting')
}

function streamTone(status: 'connecting' | 'open' | 'reconnecting'): ActivitySeverity | 'success' {
  if (status === 'open') return 'success'
  if (status === 'reconnecting') return 'warning'
  return 'info'
}

function metricIconClassName(tone: ActivitySeverity | 'success') {
  if (tone === 'success') return 'h-5 w-5 shrink-0 text-on'
  if (tone === 'error') return 'h-5 w-5 shrink-0 text-rose-500'
  if (tone === 'warning') return 'h-5 w-5 shrink-0 text-amber-500'
  return 'h-5 w-5 shrink-0 text-accent'
}

function feedDotClassName(severity: ActivitySeverity) {
  if (severity === 'success') return 'h-2 w-2 shrink-0 rounded-full bg-on'
  if (severity === 'error') return 'h-2 w-2 shrink-0 rounded-full bg-rose-500'
  if (severity === 'warning') return 'h-2 w-2 shrink-0 rounded-full bg-amber-500'
  return 'h-2 w-2 shrink-0 rounded-full bg-[var(--ink2)]'
}

function severityClassName(severity: ActivitySeverity) {
  if (severity === 'error') return 'break-words text-rose-500'
  if (severity === 'warning') return 'break-words text-amber-500'
  return 'break-words text-white'
}

function channelClassName(line: ActivityTerminalLine) {
  if (line.channel === 'stderr') return 'text-rose-500'
  return 'text-quiet'
}

function sourceClassName(_source: ActivityTerminalLine['source']) {
  return 'text-quiet'
}

function formatRelativeTime(ts: number) {
  const diff = Date.now() - ts
  if (diff < 10_000) return i18n.t('status.relativeJustNow')
  if (diff < 60_000) return i18n.t('status.relativeSecondsAgo', { count: Math.round(diff / 1000) })
  if (diff < 3_600_000) return i18n.t('status.relativeMinutesAgo', { count: Math.round(diff / 60_000) })
  if (diff < 86_400_000) return i18n.t('status.relativeHoursAgo', { count: Math.round(diff / 3_600_000) })
  return formatClockTime(ts)
}

function formatClockTime(ts: number) {
  return new Intl.DateTimeFormat([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(ts)
}
