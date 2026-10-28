import { cx } from '../lib/cx'

type Props = {
  // `primary`: the page's one main action, a pill in the ink. `accent` (the default): a pill on a veil of
  // the ink. `ghost`: ink words that do something, as a dialog's.
  variant?: 'primary' | 'accent' | 'ghost'
  active?: boolean
  className?: string
  children: React.ReactNode
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'className'>

export function Button({
  variant = 'accent',
  active = false,
  className,
  children,
  ...rest
}: Props) {
  return (
    <button
      type="button"
      className={cx(
        'inline-flex min-h-11 select-none items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition-[background,color,opacity] duration-150 disabled:cursor-default disabled:opacity-40 [&>.lucide]:h-[18px] [&>.lucide]:w-[18px]',
        active
          ? 'border-hair border-[var(--hair)] bg-surface text-white'
          : variant === 'primary'
            ? 'bg-[var(--ink)] text-[var(--page)] hover:opacity-90'
            : variant === 'ghost'
              ? 'text-white hover:bg-[var(--hover)]'
              : 'bg-[var(--veil)] text-white hover:bg-white/[0.1]',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  )
}
