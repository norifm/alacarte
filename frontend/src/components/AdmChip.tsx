import { useTranslation } from 'react-i18next'

import i18n from '../i18n'
import { cx } from '../lib/cx'

// A plain (non-hook) getter for use outside a component's render, e.g. as a
// Badge `title` built from other translated JSX — see Album.tsx.
export function admDescription() {
  return i18n.t('admChip.description')
}

// Marks single tracks as Apple Digital Masters where the whole album is not.
export function AdmChip({ className }: { className?: string }) {
  const { t } = useTranslation()
  return (
    <span
      title={t('admChip.description')}
      aria-label={t('admChip.ariaLabel')}
      className={cx(
        'ml-1.5 inline-flex items-center rounded border border-[var(--outline)] px-1 py-px align-middle text-[10px] font-semibold uppercase leading-none tracking-wider text-quiet',
        className,
      )}
    >
      {t('admChip.label')}
    </span>
  )
}
