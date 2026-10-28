import { useTranslation } from 'react-i18next'

import type { HealthReport } from '../api/client'
import { cx } from '../lib/cx'
import { Badge } from './Badge'
import i18n from '../i18n'

type Props = {
  health: HealthReport | null
  loading: boolean
  variant?: 'default' | 'shell'
}

export function HealthPill({ health, loading, variant = 'default' }: Props) {
  const { t } = useTranslation()
  // In the chrome: quiet words with the state's dot, no plate of their own.
  const shellClass =
    variant === 'shell'
      ? 'h-9 border-transparent !bg-transparent px-3 text-[13px] leading-none group-hover:!bg-[var(--hover)]'
      : ''
  if (loading || !health) {
    return <Badge className={shellClass}>{t('healthPill.checking')}</Badge>
  }
  if (health.ok) {
    if (health.wrapper?.stallActive) {
      return (
        <Badge variant="warn" className={shellClass} title={t('healthPill.stalledTitle')}>
          ● {t('healthPill.stalled')}
        </Badge>
      )
    }
    // Only shown for a couple of minutes after a stall ended; the backend
    // then reports it as over and the pill returns to ready.
    if (health.wrapper?.stallRecent) {
      return (
        <Badge
          variant="warn"
          className={shellClass}
          title={t('healthPill.stalledRecoveredTitle')}
        >
          ● {t('healthPill.recovered')}
        </Badge>
      )
    }
    return <Badge variant="ok" className={shellClass}>● {t('healthPill.ready')}</Badge>
  }
  const wrapperDown = isWrapperDown(health)
  const pause = wrapperDown ? wrapperPause(health) : null
  let label = t('healthPill.issue')
  let title = t('healthPill.somethingNotReady')
  if (pause) {
    label = pause.label
    title = pause.title
  } else if (wrapperDown) {
    label = t('healthPill.signInRequired')
    title = t('healthPill.wrapperOfflineTitle')
  } else if (!health.appleToken?.ok) {
    label = t('healthPill.appleToken')
    title = t('healthPill.appleTokenTitle')
  } else if (!health.music?.ok) {
    label = t('healthPill.musicFolder')
    title = t('healthPill.musicFolderTitle')
  } else {
    const partial: string[] = []
    if (!health.wrapper?.decrypt?.ok) partial.push('decrypt')
    if (!health.wrapper?.m3u8?.ok) partial.push('m3u8')
    if (!health.wrapper?.account?.ok) partial.push('account')
    label = t('healthPill.wrapperPartial', { detail: partial.join(', ') })
    title = label
  }
  return (
    <Badge
      variant="warn"
      className={cx('max-w-[260px] truncate', shellClass)}
      title={title}
    >
      ● {label}
    </Badge>
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
