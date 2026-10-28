// A page's big title in Literata, an optional quiet line under it, and the page's own controls beside it.
export function PageTitle({
  children,
  sub,
  aside,
}: {
  children: React.ReactNode
  sub?: React.ReactNode
  aside?: React.ReactNode
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      <div className="min-w-0">
        <h1 className="text-[31px] leading-10 md:text-[34px] md:leading-[42px]">{children}</h1>
        {sub && <div className="mt-1 max-w-2xl text-[15px] text-quiet">{sub}</div>}
      </div>
      {aside && <div className="flex flex-wrap items-center gap-2">{aside}</div>}
    </header>
  )
}
