/**
 * PermissionSelector - Permission mode selection for CLI.
 * Uses shared SelectorDropdown for consistent styling.
 */

import { useState, useRef, useCallback } from 'react'
import { SelectorDropdown, SelectorOption, SelectorButton } from './selector-dropdown'

const PERMISSION_MODES = [
  { id: 'plan', label: 'Plan', description: 'Read-only, safe mode', icon: '🔒' },
  { id: 'full', label: 'Full', description: 'All permissions', icon: '⚡' },
] as const

export type PermissionMode = (typeof PERMISSION_MODES)[number]['id']

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

  const current = PERMISSION_MODES.find((m) => m.id === selected) ?? PERMISSION_MODES[0]

  const handleSelect = useCallback((mode: PermissionMode) => {
    setSelected(mode)
    onChange?.(mode)
    setOpen(false)
  }, [onChange])

  return (
    <div ref={ref} className="relative">
      <SelectorButton onClick={() => { setOpen(!open) }} open={open}>
        <span className="text-[10px]">{current.icon}</span>
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
            icon={<span className="text-[10px]">{mode.icon}</span>}
          />
        ))}
      </SelectorDropdown>
    </div>
  )
}
