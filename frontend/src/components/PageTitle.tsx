// The top of a section's page. Its name is in the bar already, so it is there for screen readers only;
// what shows is the page's own row: what it holds (`sub`) on the left, its controls on the right.
export function PageTitle({
  children,
  sub,
  aside,
}: {
  children: React.ReactNode
  sub?: React.ReactNode
  aside?: React.ReactNode
}) {
  if (!sub && !aside) return <h1 className="sr-only">{children}</h1>
  return (
    <header className="flex min-h-11 flex-wrap items-center justify-between gap-x-4 gap-y-3">
      <h1 className="sr-only">{children}</h1>
      <div className="min-w-0">{sub}</div>
      {aside && <div className="flex flex-wrap items-center gap-2">{aside}</div>}
    </header>
  )
}
