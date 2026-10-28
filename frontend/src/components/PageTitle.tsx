// A page's big title in Literata, with its own controls beside it.
export function PageTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <header className="mb-[18px] mt-1.5 flex flex-wrap items-center justify-between gap-4">
      <h1 className="text-[31px] leading-10 md:text-[34px] md:leading-[42px]">{children}</h1>
      {aside}
    </header>
  )
}
