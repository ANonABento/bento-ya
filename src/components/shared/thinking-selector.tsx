/**
 * ThinkingSelector - Thinking/effort level selection.
 * Fully controlled — parent owns the selected level.
 * Levels beyond maxLevel are disabled.
 */

import { useState, useCallback } from 'react'
import { SelectorDropdown, SelectorButton } from './selector-dropdown'
import type { ThinkingLevel } from './thinking-utils'

const THINKING_LEVELS = [
  { id: 'none', label: 'None', description: 'No extended thinking', cliValue: undefined },
  { id: 'low', label: 'Low', description: 'Brief reasoning', cliValue: 'low' },
  { id: 'medium', label: 'Medium', description: 'Moderate depth', cliValue: 'medium' },
  { id: 'high', label: 'High', description: 'Deep analysis', cliValue: 'high' },
] as const

const LEVEL_ORDER = ['none', 'low', 'medium', 'high'] as const

interface ThinkingSelectorProps {
  value: ThinkingLevel
  /** Max allowed effort for current model (e.g. haiku only supports 'low') */
  maxLevel?: ThinkingLevel
  onChange: (level: ThinkingLevel) => void
}

export function ThinkingSelector({ value, maxLevel, onChange }: ThinkingSelectorProps) {
  const [open, setOpen] = useState(false)

  const current = THINKING_LEVELS.find((l) => l.id === value) ?? THINKING_LEVELS[2]
  const maxIdx = maxLevel ? LEVEL_ORDER.indexOf(maxLevel) : 3

  const handleSelect = useCallback((level: ThinkingLevel) => {
    onChange(level)
    setOpen(false)
  }, [onChange])

  return (
    <div className="relative">
      <SelectorButton onClick={() => { setOpen(!open) }} open={open}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" className="opacity-70">
          <path d="M6 1v2M6 9v2M1 6h2M9 6h2M2.5 2.5l1.4 1.4M8.1 8.1l1.4 1.4M2.5 9.5l1.4-1.4M8.1 3.9l1.4-1.4" />
        </svg>
        {current.label}
      </SelectorButton>

      <SelectorDropdown
        open={open}
        onClose={() => { setOpen(false) }}
        width="w-44"
      >
        {THINKING_LEVELS.map((level) => {
          const levelIdx = LEVEL_ORDER.indexOf(level.id)
          const disabled = levelIdx > maxIdx
          return (
            <button
              key={level.id}
              type="button"
              onClick={() => { if (!disabled) handleSelect(level.id) }}
              disabled={disabled}
              className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                disabled
                  ? 'text-text-muted/30 cursor-not-allowed'
                  : level.id === value
                    ? 'text-accent hover:bg-surface-hover'
                    : 'text-text-secondary hover:bg-surface-hover'
              }`}
            >
              <div className="flex-1 min-w-0">
                <div className="font-medium">{level.label}</div>
                <div className="text-text-muted text-[10px]">{level.description}</div>
              </div>
              {level.id === value && !disabled && (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5 shrink-0">
                  <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
                </svg>
              )}
            </button>
          )
        })}
      </SelectorDropdown>
    </div>
  )
}
