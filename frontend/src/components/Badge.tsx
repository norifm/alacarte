import { cx } from '../lib/cx'

type Variant = 'accent' | 'ok' | 'bad' | 'warn' | 'muted'

// A chip of quiet words on the surface; a state reads in its own color (the season's second voice for
// "ok", the error color for "bad").
const variantClasses: Record<Variant, string> = {
  accent: 'border-[var(--hair)] bg-surface text-quiet',
  ok: 'border-[var(--hair)] bg-surface text-on',
  bad: 'border-rose-500/40 bg-rose-500/[0.08] text-rose-500',
  warn: 'border-[var(--hair)] bg-surface text-amber-500',
  muted: 'border-[var(--hair)] bg-surface text-quiet',
}

type Props = {
  variant?: Variant
  className?: string
  children: React.ReactNode
} & Omit<React.HTMLAttributes<HTMLSpanElement>, 'className'>

export function Badge({
  variant = 'accent',
  className,
  children,
  ...rest
}: Props) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full border-hair px-2.5 py-1 text-xs font-medium',
        variantClasses[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  )
}
