import { useState, useRef, useEffect } from 'react'

const MODES = ['Code', 'Chat', 'Edit'] as const
type Mode = (typeof MODES)[number]

interface ModeSelectorProps {
  value?: Mode
  onChange?: (mode: Mode) => void
}

export function ModeSelector({ value = 'Code', onChange }: ModeSelectorProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => { document.removeEventListener('mousedown', handleClickOutside); }
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => { setOpen(!open); }}
        className="flex items-center gap-1 rounded px-2 py-1 text-xs text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
      >
        {value}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
          <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.2" fill="none" />
        </svg>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1 rounded border border-border-default bg-bg-secondary py-1 shadow-lg">
          {MODES.map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => {
                onChange?.(mode)
                setOpen(false)
              }}
              className={`block w-full px-3 py-1 text-left text-xs hover:bg-bg-tertiary ${
                mode === value ? 'text-accent' : 'text-text-secondary'
              }`}
            >
              {mode}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
