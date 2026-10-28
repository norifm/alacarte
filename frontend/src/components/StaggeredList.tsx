// Lists appear as they are: nothing moves unless it was touched.
type Props = {
  children: React.ReactNode
  className?: string
  style?: React.CSSProperties
}

export function StaggeredList({ children, className, style }: Props) {
  return (
    <div className={className} style={style}>
      {children}
    </div>
  )
}

export function StaggeredItem({ children, className, style }: Props) {
  return (
    <div className={className} style={style}>
      {children}
    </div>
  )
}
