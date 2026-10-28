import { forwardRef } from 'react'
import { cx } from '../lib/cx'

type Props = React.InputHTMLAttributes<HTMLInputElement> & {
  className?: string
}

// A form field: the card's corners, filled with a veil of the ink, no outline; the accent only while
// focused.
export const Input = forwardRef<HTMLInputElement, Props>(
  ({ className, ...rest }, ref) => (
    <input
      ref={ref}
      className={cx(
        'w-full rounded-card border border-transparent bg-[var(--field)] px-4 py-3 text-white placeholder:text-quiet outline-none',
        'transition-[border-color] duration-150',
        'focus:border-accent/60',
        className,
      )}
      {...rest}
    />
  ),
)
