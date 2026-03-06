import { useState, useRef, useEffect } from 'react'

const THINKING_LEVELS = [
  { id: 'none', label: 'None', description: 'No extended thinking' },
  { id: 'low', label: 'Low', description: 'Brief reasoning' },
  { id: 'medium', label: 'Medium', description: 'Moderate depth' },
  { id: 'high', label: 'High', description: 'Deep analysis' },
] as const

export type ThinkingLevel = (typeof THINKING_LEVELS)[number]['id']

interface ThinkingSelectorProps {
  value?: ThinkingLevel
  onChange?: (level: ThinkingLevel) => void
}

export function ThinkingSelector({ value = 'medium', onChange }: ThinkingSelectorProps) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<ThinkingLevel>(value)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => { document.removeEventListener('mousedown', handleClickOutside) }
  }, [])

  const current = THINKING_LEVELS.find((l) => l.id === selected) ?? THINKING_LEVELS[2]

  const handleSelect = (level: ThinkingLevel) => {
    setSelected(level)
    onChange?.(level)
    setOpen(false)
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => { setOpen(!open) }}
        className="flex items-center gap-1 rounded px-2 py-1 text-xs text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2">
          <path d="M6 1v2M6 9v2M1 6h2M9 6h2M2.5 2.5l1.4 1.4M8.1 8.1l1.4 1.4M2.5 9.5l1.4-1.4M8.1 3.9l1.4-1.4" />
        </svg>
        {current.label}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
          <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.2" fill="none" />
        </svg>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1 w-40 rounded border border-border-default bg-bg-secondary py-1 shadow-lg">
          {THINKING_LEVELS.map((level) => (
            <button
              key={level.id}
              type="button"
              onClick={() => { handleSelect(level.id) }}
              className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-bg-tertiary ${
                level.id === selected ? 'text-accent' : 'text-text-secondary'
              }`}
            >
              <div className="font-medium">{level.label}</div>
              <div className="text-text-muted text-[10px]">{level.description}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
