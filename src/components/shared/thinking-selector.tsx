/**
 * ThinkingSelector - Thinking/effort level selection.
 * Uses shared SelectorDropdown for consistent styling.
 */

import { useState, useRef, useCallback } from 'react'
import { SelectorDropdown, SelectorOption, SelectorButton } from './selector-dropdown'

const THINKING_LEVELS = [
  { id: 'none', label: 'None', description: 'No extended thinking', cliValue: undefined },
  { id: 'low', label: 'Low', description: 'Brief reasoning', cliValue: 'low' },
  { id: 'medium', label: 'Medium', description: 'Moderate depth', cliValue: 'medium' },
  { id: 'high', label: 'High', description: 'Deep analysis', cliValue: 'high' },
] as const

export type ThinkingLevel = (typeof THINKING_LEVELS)[number]['id']

/** Map thinking level to CLI --effort value (undefined = omit flag) */
export function thinkingToEffort(level: ThinkingLevel): string | undefined {
  return THINKING_LEVELS.find((l) => l.id === level)?.cliValue
}

const LEVEL_ORDER = ['none', 'low', 'medium', 'high'] as const

interface ThinkingSelectorProps {
  value?: ThinkingLevel
  /** Max allowed effort for current model (e.g. haiku only supports 'low') */
  maxLevel?: ThinkingLevel
  onChange?: (level: ThinkingLevel) => void
}

export function ThinkingSelector({ value = 'medium', maxLevel, onChange }: ThinkingSelectorProps) {
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
        {THINKING_LEVELS.map((level) => {
          const maxIdx = maxLevel ? LEVEL_ORDER.indexOf(maxLevel) : 3
          const levelIdx = LEVEL_ORDER.indexOf(level.id)
          const disabled = levelIdx > maxIdx
          return (
          <SelectorOption
            key={level.id}
            selected={level.id === selected}
            onClick={() => { if (!disabled) handleSelect(level.id) }}
            label={disabled ? `${level.label} (not available)` : level.label}
            description={level.description}
          />
          )
        })}
      </SelectorDropdown>
    </div>
  )
}
