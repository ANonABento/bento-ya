/**
 * SelectorDropdown - Unified dropdown component for selectors.
 * Single source of truth for dropdown styling.
 */

import { useRef, useEffect, type ReactNode } from 'react'

type SelectorDropdownProps = {
  /** Whether dropdown is open */
  open: boolean
  /** Called when dropdown should close */
  onClose: () => void
  /** Dropdown width class (e.g., 'w-44') */
  width?: string
  /** Optional header content */
  header?: ReactNode
  /** Dropdown items */
  children: ReactNode
}

export function SelectorDropdown({
  open,
  onClose,
  width = 'w-44',
  header,
  children,
}: SelectorDropdownProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => { document.removeEventListener('mousedown', handleClickOutside) }
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      ref={ref}
      className={`absolute bottom-full left-0 mb-1 ${width} rounded-lg border border-border-default bg-surface shadow-lg z-50 overflow-hidden`}
    >
      {header && (
        <div className="px-3 py-1.5 border-b border-border-default bg-bg/50 text-[10px] text-text-muted">
          {header}
        </div>
      )}
      <div className="py-1">
        {children}
      </div>
    </div>
  )
}

type SelectorOptionProps = {
  /** Whether this option is selected */
  selected?: boolean
  /** Click handler */
  onClick: () => void
  /** Option label */
  label: string
  /** Optional description */
  description?: string
  /** Optional left icon */
  icon?: ReactNode
}

export function SelectorOption({
  selected,
  onClick,
  label,
  description,
  icon,
}: SelectorOptionProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-surface-hover ${
        selected ? 'text-accent' : 'text-text-secondary'
      }`}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      <div className="flex-1 min-w-0">
        <div className="font-medium">{label}</div>
        {description && (
          <div className="text-text-muted text-[10px]">{description}</div>
        )}
      </div>
      {selected && (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5 shrink-0">
          <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
        </svg>
      )}
    </button>
  )
}

type SelectorButtonProps = {
  /** Click handler */
  onClick: () => void
  /** Button content */
  children: ReactNode
  /** Whether dropdown is open (for chevron rotation) */
  open?: boolean
  /** Additional class names */
  className?: string
}

export function SelectorButton({
  onClick,
  children,
  open,
  className = '',
}: SelectorButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 rounded px-2 py-1 text-xs text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-colors ${className}`}
    >
      {children}
      <svg
        width="10"
        height="10"
        viewBox="0 0 10 10"
        fill="none"
        className={`transition-transform ${open ? 'rotate-180' : ''}`}
      >
        <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.2" />
      </svg>
    </button>
  )
}
