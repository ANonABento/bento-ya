/**
 * PermissionSelector - Permission mode selection (fully controlled).
 * Parent owns selected state.
 */

import { useState, useCallback } from 'react'
import { SelectorDropdown, SelectorOption, SelectorButton } from './selector-dropdown'
import type { PermissionMode } from './permission-utils'

type PermissionModeConfig = {
  id: 'plan' | 'full'
  label: string
  description: string
}

const PERMISSION_MODES: PermissionModeConfig[] = [
  { id: 'plan', label: 'Plan', description: 'Read-only, safe mode' },
  { id: 'full', label: 'Full', description: 'All permissions' },
]

interface PermissionSelectorProps {
  value: PermissionMode
  onChange: (mode: PermissionMode) => void
}

export function PermissionSelector({ value, onChange }: PermissionSelectorProps) {
  const [open, setOpen] = useState(false)

  const current = PERMISSION_MODES.find((m) => m.id === value) ?? PERMISSION_MODES[0]

  const handleSelect = useCallback((mode: PermissionMode) => {
    onChange(mode)
    setOpen(false)
  }, [onChange])

  return (
    <div className="relative">
      <SelectorButton onClick={() => { setOpen(!open) }} open={open}>
        {current?.label}
      </SelectorButton>

      <SelectorDropdown
        open={open}
        onClose={() => { setOpen(false) }}
        width="w-40"
      >
        {PERMISSION_MODES.map((mode) => (
          <SelectorOption
            key={mode.id}
            selected={mode.id === value}
            onClick={() => { handleSelect(mode.id) }}
            label={mode.label}
            description={mode.description}
          />
        ))}
      </SelectorDropdown>
    </div>
  )
}
