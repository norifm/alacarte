import { Link, useLocation } from 'react-router-dom'
import { Activity, NavArrowRight as ChevronRight } from 'iconoir-react'
import { useTranslation } from 'react-i18next'

import type { HealthReport } from '../api/client'
import { cx } from '../lib/cx'
import i18n from '../i18n'

type Tone = 'checking' | 'ok' | 'warn'

type Status = { tone: Tone; label: string; title: string }

// What the backend's health says, in a word and a sentence.
function healthStatus(health: HealthReport | null, loading: boolean): Status {
  const t = i18n.t.bind(i18n)
  if (loading || !health) {
    const label = t('healthPill.checking')
    return { tone: 'checking', label, title: label }
  }
  if (health.ok) {
    if (health.wrapper?.stallActive) {
      return { tone: 'warn', label: t('healthPill.stalled'), title: t('healthPill.stalledTitle') }
    }
    // Only shown for a couple of minutes after a stall ended; the backend
    // then reports it as over and the status returns to ready.
    if (health.wrapper?.stallRecent) {
      return { tone: 'warn', label: t('healthPill.recovered'), title: t('healthPill.stalledRecoveredTitle') }
    }
    const label = t('healthPill.ready')
    return { tone: 'ok', label, title: label }
  }
  const wrapperDown = isWrapperDown(health)
  const pause = wrapperDown ? wrapperPause(health) : null
  if (pause) return { tone: 'warn', ...pause }
  if (wrapperDown) {
    return { tone: 'warn', label: t('healthPill.signInRequired'), title: t('healthPill.wrapperOfflineTitle') }
  }
  if (!health.appleToken?.ok) {
    return { tone: 'warn', label: t('healthPill.appleToken'), title: t('healthPill.appleTokenTitle') }
  }
  if (!health.music?.ok) {
    return { tone: 'warn', label: t('healthPill.musicFolder'), title: t('healthPill.musicFolderTitle') }
  }
  const partial: string[] = []
  if (!health.wrapper?.decrypt?.ok) partial.push('decrypt')
  if (!health.wrapper?.m3u8?.ok) partial.push('m3u8')
  if (!health.wrapper?.account?.ok) partial.push('account')
  const label = t('healthPill.wrapperPartial', { detail: partial.join(', ') })
  return { tone: 'warn', label, title: label }
}

const DOT: Record<Tone, string> = {
  checking: 'bg-[var(--ink2)]',
  ok: 'bg-on',
  warn: 'bg-amber-500',
}

type Props = {
  health: HealthReport | null
  loading: boolean
}

// The status in the top bar: a glyph of a fixed size, so nothing beside it moves whatever it says, with the
// state's dot on it; the words are its tooltip. Anything but ready colors the glyph too.
export function HealthGlyph({ health, loading }: Props) {
  useTranslation()
  const here = useLocation().pathname === '/status'
  const s = healthStatus(health, loading)
  return (
    <Link
      to={getHealthPillTarget(health)}
      aria-label={`${s.title}. ${getHealthPillAriaLabel(health)}`}
      title={s.title}
      className={cx('glyph h-9 w-9', s.tone === 'warn' ? '!text-amber-500' : here ? 'on' : 'quiet')}
    >
      <Activity className="h-5 w-5" />
      <span className={cx('!absolute right-[7px] top-[7px] h-2 w-2 rounded-full ring-2 ring-[var(--page)]', DOT[s.tone])} />
    </Link>
  )
}

// The status on a phone: the whole row over the tabs, as nori's mini player sits there; the state's dot and
// word, the sentence when it is not ready, and a way to the status.
export function HealthRow({ health, loading }: Props) {
  useTranslation()
  const s = healthStatus(health, loading)
  return (
    <Link
      to={getHealthPillTarget(health)}
      aria-label={getHealthPillAriaLabel(health)}
      className="flex min-h-11 w-full items-center gap-2.5 px-4 text-[13px] transition-colors active:bg-[var(--hover)]"
    >
      <span className={cx('h-2 w-2 shrink-0 rounded-full', DOT[s.tone])} />
      <span className={cx('shrink-0 font-semibold', s.tone === 'warn' ? 'text-amber-500' : 'text-white')}>{s.label}</span>
      {s.title !== s.label && <span className="min-w-0 truncate text-quiet">{s.title}</span>}
      <ChevronRight className="ml-auto h-[18px] w-[18px] shrink-0 text-quiet opacity-70" />
    </Link>
  )
}

function isWrapperDown(health: HealthReport): boolean {
  return (
    !health.wrapper?.decrypt?.ok &&
    !health.wrapper?.m3u8?.ok &&
    !health.wrapper?.account?.ok
  )
}

// The ports are also closed while the supervisor restarts the wrapper, or
// waits because another device took the Apple Music stream; neither needs a
// new sign-in.
function wrapperPause(health: HealthReport): { label: string; title: string } | null {
  const sup = health.wrapper?.supervisor
  if (!sup) return null
  if (sup.reason === 'lease_lost') {
    const mins = Math.max(1, Math.ceil((sup.restartInMs ?? 0) / 60_000))
    return {
      label: i18n.t('healthPill.paused'),
      title: i18n.t('healthPill.leaseLostTitle', { mins }),
    }
  }
  if (sup.running || sup.restartInMs != null) {
    return {
      label: i18n.t('healthPill.wrapperRestarting'),
      title: i18n.t('healthPill.wrapperRestartingTitle'),
    }
  }
  return null
}

function needsSignIn(health: HealthReport): boolean {
  return isWrapperDown(health) && !wrapperPause(health)
}

export function getHealthPillTarget(health: HealthReport | null): string {
  if (!health) return '/status'
  return needsSignIn(health) ? '/settings' : '/status'
}

export function getHealthPillAriaLabel(health: HealthReport | null): string {
  if (!health) return i18n.t('healthPill.openStatus')
  return needsSignIn(health) ? i18n.t('healthPill.openSettings') : i18n.t('healthPill.openStatus')
}
