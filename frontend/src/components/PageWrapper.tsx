import { motion } from 'framer-motion'
import { cx } from '../lib/cx'

type Props = {
  children: React.ReactNode
  className?: string
}

// A page change cross-fades; nothing slides.
export function PageWrapper({ children, className }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.14, ease: 'easeOut' }}
      className={cx('w-full', className)}
    >
      {children}
    </motion.div>
  )
}
