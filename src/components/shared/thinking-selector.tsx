/**
 * ThinkingSelector - Thinking/effort level selection.
 * Uses shared SelectorDropdown for consistent styling.
 */

import { useState, useRef, useCallback } from 'react'
import { SelectorDropdown, SelectorOption, SelectorButton } from './selector-dropdown'

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

  const current = THINKING_LEVELS.find((l) => l.id === selected) ?? THINKING_LEVELS[2]

  const handleSelect = useCallback((level: ThinkingLevel) => {
    setSelected(level)
    onChange?.(level)
    setOpen(false)
  }, [onChange])

  return (
    <div ref={ref} className="relative">
      <SelectorButton onClick={() => { setOpen(!open) }} open={open}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" className="opacity-70">
          <path d="M6 1v2M6 9v2M1 6h2M9 6h2M2.5 2.5l1.4 1.4M8.1 8.1l1.4 1.4M2.5 9.5l1.4-1.4M8.1 3.9l1.4-1.4" />
        </svg>
        {current.label}
      </SelectorButton>

      <SelectorDropdown
        open={open}
        onClose={() => { setOpen(false) }}
        width="w-40"
      >
        {THINKING_LEVELS.map((level) => (
          <SelectorOption
            key={level.id}
            selected={level.id === selected}
            onClick={() => { handleSelect(level.id) }}
            label={level.label}
            description={level.description}
          />
        ))}
      </SelectorDropdown>
    </div>
  )
}
