import { useMemo, useRef, useState } from 'react'
import { Xmark as X } from 'iconoir-react'

import { cx } from '../lib/cx'

export type LanguageOption = { code: string; label: string }

type Props = {
  value: string[]
  onChange: (next: string[]) => void
  options: LanguageOption[]
  placeholder?: string
  emptyHint?: string
}

/**
 * Ordered, tag-style language picker: type to search, click a suggestion to
 * add a removable chip, drag chips to reorder. Order is meaningful — it's a
 * preference ranking, first = most preferred (see Settings' "accepted
 * languages" field).
 */
export function LanguageChipInput({ value, onChange, options, placeholder, emptyHint }: Props) {
  const [query, setQuery] = useState('')
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  const labelFor = (code: string) => options.find((o) => o.code === code)?.label || code

  const suggestions = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return []
    return options
      .filter((o) => !value.includes(o.code))
      .filter((o) => o.label.toLowerCase().includes(q) || o.code.toLowerCase().includes(q))
      .slice(0, 8)
  }, [query, options, value])

  const addCode = (code: string) => {
    if (value.includes(code)) return
    onChange([...value, code])
    setQuery('')
    inputRef.current?.focus()
  }

  const removeCode = (code: string) => {
    onChange(value.filter((c) => c !== code))
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (suggestions[0]) addCode(suggestions[0].code)
    } else if (e.key === 'Backspace' && !query && value.length > 0) {
      removeCode(value[value.length - 1])
    } else if (e.key === 'Escape') {
      setQuery('')
      inputRef.current?.blur()
    }
  }

  const reorder = (from: number, to: number) => {
    if (from === to) return
    const next = value.slice()
    const [moved] = next.splice(from, 1)
    next.splice(to, 0, moved)
    onChange(next)
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1.5 rounded-card bg-[var(--field)] p-2">
        {value.map((code, i) => (
          <span
            key={code}
            draggable
            onDragStart={() => setDragIndex(i)}
            onDragOver={(e) => {
              e.preventDefault()
              if (overIndex !== i) setOverIndex(i)
            }}
            onDrop={(e) => {
              e.preventDefault()
              if (dragIndex != null) reorder(dragIndex, i)
              setDragIndex(null)
              setOverIndex(null)
            }}
            onDragEnd={() => {
              setDragIndex(null)
              setOverIndex(null)
            }}
            className={cx(
              'inline-flex cursor-grab select-none items-center gap-1.5 rounded-full border-hair border-[var(--hair)] bg-surface py-1 pl-3 pr-1.5 text-[13px] font-medium text-white active:cursor-grabbing',
              overIndex === i && dragIndex !== null && dragIndex !== i && '!border-[var(--outline)]',
            )}
            title="Drag to reorder"
          >
            {labelFor(code)}
            <button
              type="button"
              onClick={() => removeCode(code)}
              className="inline-flex h-4 w-4 items-center justify-center rounded-full text-quiet hover:bg-[var(--hover)] hover:text-white"
              aria-label={`Remove ${labelFor(code)}`}
            >
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        <div className="relative flex-1 min-w-[8rem]">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={value.length === 0 ? placeholder : undefined}
            className="w-full min-w-[8rem] bg-transparent px-2 py-1 text-sm text-white placeholder:text-quiet outline-none"
          />
          {suggestions.length > 0 && (
            // opens upward: the input sits at the bottom of its card, which clips overflow
            <ul className="popover absolute bottom-full left-0 z-10 mb-1 w-52">
              {suggestions.map((o) => (
                <li key={o.code}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => addCode(o.code)}
                    className="popover-item justify-between"
                  >
                    <span>{o.label}</span>
                    <span className="text-xs uppercase text-quiet">{o.code}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {value.length === 0 && emptyHint && (
        <p className="mt-1.5 text-xs text-quiet">{emptyHint}</p>
      )}
    </div>
  )
}
