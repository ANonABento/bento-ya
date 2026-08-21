import type { ReactNode } from 'react'
import { Tooltip } from '@/components/shared/tooltip'
import { useUIStore, type AppSection } from '@/stores/ui-store'

/**
 * Left nav rail — switches the top-level app section.
 *
 * Generic over its item list so adding a section later (Orchestrator, once its
 * dock geometry is untangled from Board) is one entry, not a rewrite.
 *
 * Styling follows the settings-panel nav: `bg-accent/10 text-accent` selected,
 * muted otherwise. Cursor is set inline rather than via `cursor-pointer` —
 * Tailwind cursor classes don't apply reliably in macOS WKWebView (see the
 * pitfalls section in CLAUDE.md).
 */

type RailItem = {
  value: AppSection
  label: string
  icon: ReactNode
  testId: string
}

function BoardIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
      <path d="M3 3.5A1.5 1.5 0 0 1 4.5 2h2A1.5 1.5 0 0 1 8 3.5v13A1.5 1.5 0 0 1 6.5 18h-2A1.5 1.5 0 0 1 3 16.5v-13ZM10 3.5A1.5 1.5 0 0 1 11.5 2h2A1.5 1.5 0 0 1 15 3.5v7a1.5 1.5 0 0 1-1.5 1.5h-2A1.5 1.5 0 0 1 10 10.5v-7Z" />
    </svg>
  )
}

function RosterIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
      <path d="M10 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3.465 16.036A7.002 7.002 0 0 1 10 11.5a7.002 7.002 0 0 1 6.535 4.536.75.75 0 0 1-.702 1.014H4.167a.75.75 0 0 1-.702-1.014Z" />
    </svg>
  )
}

const RAIL_ITEMS: readonly RailItem[] = [
  { value: 'board', label: 'Board', icon: <BoardIcon />, testId: 'nav-rail-board' },
  { value: 'roster', label: 'Roster', icon: <RosterIcon />, testId: 'nav-rail-roster' },
]

export function NavRail() {
  const activeSection = useUIStore((s) => s.activeSection)
  const setActiveSection = useUIStore((s) => s.setActiveSection)

  return (
    <nav
      aria-label="Sections"
      className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-border-default bg-surface/40 py-2"
    >
      {RAIL_ITEMS.map((item) => {
        const isActive = activeSection === item.value
        return (
          <Tooltip key={item.value} content={item.label} side="right">
            <button
              type="button"
              onClick={() => {
                setActiveSection(item.value)
              }}
              aria-current={isActive ? 'page' : undefined}
              aria-label={item.label}
              data-testid={item.testId}
              style={{ cursor: 'pointer' }}
              className={`flex h-9 w-9 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg ${
                isActive
                  ? 'bg-accent/10 text-accent'
                  : 'text-text-secondary hover:bg-surface hover:text-text-primary'
              }`}
            >
              {item.icon}
            </button>
          </Tooltip>
        )
      })}
    </nav>
  )
}
