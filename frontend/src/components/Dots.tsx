// Loading: three dots breathing in turn, invisible for the first 250 ms.
export function Dots({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex gap-1.5 animate-[dots-in_250ms_250ms_both] ${className}`} aria-label="Loading">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="h-1.5 w-1.5 rounded-full bg-[var(--ink2)] animate-[breathe_1.2s_ease-in-out_infinite]"
          style={{ animationDelay: `${i * 0.16}s` }}
        />
      ))}
    </span>
  )
}
