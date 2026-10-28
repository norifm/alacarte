import { useTranslation } from 'react-i18next'

import type { ReleaseScope } from '../api/client'
import { cx } from '../lib/cx'
import i18n from '../i18n'

export const RELEASE_SCOPE_OPTIONS: Array<{ value: ReleaseScope; labelKey: string; hintKey: string }> = [
  { value: 'everything', labelKey: 'releaseScopePicker.everythingLabel', hintKey: 'releaseScopePicker.everythingHint' },
  { value: 'albums', labelKey: 'releaseScopePicker.albumsLabel', hintKey: 'releaseScopePicker.albumsHint' },
  { value: 'singles_eps', labelKey: 'releaseScopePicker.singlesEpsLabel', hintKey: 'releaseScopePicker.singlesEpsHint' },
]

type Props = {
  value: ReleaseScope
  onChange: (value: ReleaseScope) => void
  compact?: boolean
  disabled?: boolean
  className?: string
}

export function ReleaseScopePicker({ value, onChange, compact = false, disabled = false, className }: Props) {
  const { t } = useTranslation()
  return (
    <div
      className={cx(
        compact ? 'inline-flex flex-wrap gap-0.5' : 'grid gap-1',
        className,
      )}
      role="radiogroup"
      aria-label={t('releaseScopePicker.ariaLabel')}
    >
      {RELEASE_SCOPE_OPTIONS.map((option) => {
        const selected = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cx(
              compact
                ? 'h-7 rounded-full px-2.5 text-xs font-medium transition-colors disabled:opacity-60'
                : 'flex w-full items-start gap-3 rounded-card border-hair px-3 py-2.5 text-left transition-colors disabled:opacity-60',
              selected
                ? compact
                  ? 'bg-[var(--chosen)] text-white'
                  : 'border-[var(--hair)] bg-[var(--chosen)] text-white'
                : compact
                  ? 'text-quiet hover:text-white'
                  : 'border-transparent text-white hover:bg-[var(--hover)]',
            )}
          >
            {compact ? (
              t(option.labelKey)
            ) : (
              <>
                <span
                  className={cx(
                    'mt-0.5 h-4 w-4 shrink-0 rounded-full border-[1.5px]',
                    selected
                      ? 'border-[var(--ink)] bg-[var(--ink)] shadow-[inset_0_0_0_3px_var(--surface)]'
                      : 'border-[var(--outline)]',
                  )}
                />
                <span className="min-w-0">
                  <span className="block text-[15px] font-medium">{t(option.labelKey)}</span>
                  <span className="mt-0.5 block text-[13px] text-quiet">{t(option.hintKey)}</span>
                </span>
              </>
            )}
          </button>
        )
      })}
    </div>
  )
}

export function releaseScopeLabel(value: ReleaseScope) {
  const option = RELEASE_SCOPE_OPTIONS.find((option) => option.value === value)
  return i18n.t(option?.labelKey || 'releaseScopePicker.everythingLabel')
}
