/**
 * PanelTabs — the single source of truth for the view-switcher tab row used in
 * the orchestrator and per-task agent panels. Underline-active style (lifted
 * from the agent panel, which was the cleaner of the two), with optional icons.
 * Generic over the tab value so each panel keeps its own typed union.
 */

import type { ReactNode } from 'react'

export type PanelTab<T extends string> = {
  value: T
  label: string
  icon?: ReactNode
  testId?: string
}

type PanelTabsProps<T extends string> = {
  tabs: readonly PanelTab<T>[]
  value: T
  onChange: (value: T) => void
  /** Extra classes for the row container (e.g. border-b, padding). */
  className?: string
  /** Icon-only (label as tooltip) — for tight headers like the agent panel. */
  iconOnly?: boolean
  'aria-label'?: string
}

export function PanelTabs<T extends string>({
  tabs,
  value,
  onChange,
  className = '',
  iconOnly = false,
  'aria-label': ariaLabel,
}: PanelTabsProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`inline-flex min-w-0 items-center gap-1 ${className}`}
    >
      {tabs.map((tab) => {
        const active = tab.value === value
        return (
          <button
            key={tab.value}
            type="button"
            aria-pressed={active}
            aria-label={iconOnly ? tab.label : undefined}
            title={iconOnly ? tab.label : undefined}
            data-testid={tab.testId}
            onClick={() => { onChange(tab.value) }}
            className={`relative inline-flex min-w-0 items-center gap-1.5 py-1.5 text-[11px] font-medium transition-colors ${
              iconOnly ? 'px-1.5' : 'px-2'
            } ${active ? 'text-text-primary' : 'text-text-secondary hover:text-text-primary'}`}
            style={{ cursor: 'pointer' }}
          >
            {tab.icon}
            {!iconOnly && <span className="truncate">{tab.label}</span>}
            {active && (
              <span className="absolute inset-x-1 bottom-0 h-px rounded-full bg-accent" aria-hidden="true" />
            )}
          </button>
        )
      })}
    </div>
  )
}
