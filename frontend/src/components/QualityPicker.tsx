import { useTranslation } from 'react-i18next'

import type { QualityPreference } from '../api/client'
import { cx } from '../lib/cx'

export const QUALITY_OPTIONS: Array<{ value: QualityPreference; labelKey: string; hintKey: string }> = [
  { value: 'flac', labelKey: 'qualityPicker.flacLabel', hintKey: 'qualityPicker.flacHint' },
  { value: 'alac', labelKey: 'qualityPicker.alacLabel', hintKey: 'qualityPicker.alacHint' },
  { value: 'atmos', labelKey: 'qualityPicker.atmosLabel', hintKey: 'qualityPicker.atmosHint' },
  { value: 'aac', labelKey: 'qualityPicker.aacLabel', hintKey: 'qualityPicker.aacHint' },
]

type Props = {
  value: QualityPreference
  onChange: (value: QualityPreference) => void
  className?: string
}

export function QualityPicker({ value, onChange, className }: Props) {
  const { t } = useTranslation()
  return (
    <div className={cx('grid gap-1', className)} role="radiogroup" aria-label={t('qualityPicker.ariaLabel')}>
      {QUALITY_OPTIONS.map((option) => {
        const selected = value === option.value
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(option.value)}
            className={cx(
              'flex w-full items-start gap-3 rounded-card border-hair px-3 py-2.5 text-left transition-colors',
              selected
                ? 'border-[var(--hair)] bg-[var(--chosen)] text-white'
                : 'border-transparent text-white hover:bg-[var(--hover)]',
            )}
          >
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
          </button>
        )
      })}
    </div>
  )
}
