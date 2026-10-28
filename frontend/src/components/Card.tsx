import { cx } from '../lib/cx'

type Props = {
  hover?: boolean
  className?: string
  children: React.ReactNode
} & Omit<React.HTMLAttributes<HTMLDivElement>, 'className'>

// A raised plate: the surface, a hairline edge, the tile's corners. No shadow.
export function Card({ hover, className, children, ...rest }: Props) {
  return (
    <div
      className={cx(
        'rounded-tile border-hair border-[var(--hair)] bg-surface overflow-hidden',
        hover && 'transition-colors duration-150 hover:bg-[color-mix(in_srgb,var(--ink)_4%,var(--surface))]',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
}
