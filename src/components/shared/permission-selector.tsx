/**
 * PermissionSelector - Permission mode selection for CLI.
 * Uses shared SelectorDropdown for consistent styling.
 */

import { useState, useRef, useCallback, type ReactNode } from 'react'
import { SelectorDropdown, SelectorOption, SelectorButton } from './selector-dropdown'

// SVG icons for permission modes
const LockIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="opacity-70">
    <path fillRule="evenodd" d="M8 1a3.5 3.5 0 0 0-3.5 3.5V7A1.5 1.5 0 0 0 3 8.5v5A1.5 1.5 0 0 0 4.5 15h7a1.5 1.5 0 0 0 1.5-1.5v-5A1.5 1.5 0 0 0 11.5 7V4.5A3.5 3.5 0 0 0 8 1Zm2 6V4.5a2 2 0 1 0-4 0V7h4Z" clipRule="evenodd" />
  </svg>
)

const BoltIcon = () => (
  <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" className="opacity-70">
    <path d="M9.58 1.077a.75.75 0 0 1 .405.82L9.165 6h4.085a.75.75 0 0 1 .567 1.241l-6.5 7.5a.75.75 0 0 1-1.302-.638L6.835 10H2.75a.75.75 0 0 1-.567-1.241l6.5-7.5a.75.75 0 0 1 .897-.182Z" />
  </svg>
)

type PermissionModeConfig = {
  id: 'plan' | 'full'
  label: string
  description: string
  icon: ReactNode
}

const PERMISSION_MODES: PermissionModeConfig[] = [
  { id: 'plan', label: 'Plan', description: 'Read-only, safe mode', icon: <LockIcon /> },
  { id: 'full', label: 'Full', description: 'All permissions', icon: <BoltIcon /> },
]

export type PermissionMode = PermissionModeConfig['id']

// Map UI modes to CLI flags
export const PERMISSION_CLI_FLAGS: Record<PermissionMode, string> = {
  plan: 'plan',
  full: 'bypassPermissions',
}

interface PermissionSelectorProps {
  value?: PermissionMode
  onChange?: (mode: PermissionMode) => void
}

export function PermissionSelector({ value = 'plan', onChange }: PermissionSelectorProps) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<PermissionMode>(value)
  const ref = useRef<HTMLDivElement>(null)

  const current = PERMISSION_MODES.find((m) => m.id === selected) ?? { id: 'plan' as const, label: 'Plan', description: 'Read-only, safe mode', icon: <LockIcon /> }

  const handleSelect = useCallback((mode: PermissionMode) => {
    setSelected(mode)
    onChange?.(mode)
    setOpen(false)
  }, [onChange])

  return (
    <div ref={ref} className="relative">
      <SelectorButton onClick={() => { setOpen(!open) }} open={open}>
        {current.icon}
        {current.label}
      </SelectorButton>

      <SelectorDropdown
        open={open}
        onClose={() => { setOpen(false) }}
        width="w-40"
      >
        {PERMISSION_MODES.map((mode) => (
          <SelectorOption
            key={mode.id}
            selected={mode.id === selected}
            onClick={() => { handleSelect(mode.id) }}
            label={mode.label}
            description={mode.description}
            icon={mode.icon}
          />
        ))}
      </SelectorDropdown>
    </div>
  )
}
