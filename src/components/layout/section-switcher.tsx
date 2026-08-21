import type { ReactNode } from 'react'
import { motion } from 'motion/react'
import { Tooltip } from '@/components/shared/tooltip'
import { useUIStore, type AppSection } from '@/stores/ui-store'

/**
 * Top-bar section switcher — Board / Roster.
 *
 * Lives on the left of the workspace tab bar, mirroring the icon-button cluster
 * on the right. Deliberately uses the identical recipe to `AddTabButton` /
 * `SettingsButton` / `ShowArchivedButton` (h-8 w-8, motion scale, 20x20 solid
 * icon) so the two clusters read as one row of controls rather than two systems.
 *
 * Generic over its item list, so adding a section later (Orchestrator, once its
 * dock geometry is untangled from Board) is one entry.
 */

type SectionItem = {
  value: AppSection
  label: string
  icon: ReactNode
  testId: string
}

/** Solid 20x20 heroicons-style glyphs — the tab bar's established icon shape. */
function BoardIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
      <path d="M3 4.75A1.75 1.75 0 0 1 4.75 3h2A1.75 1.75 0 0 1 8.5 4.75v10.5A1.75 1.75 0 0 1 6.75 17h-2A1.75 1.75 0 0 1 3 15.25V4.75ZM11.5 4.75A1.75 1.75 0 0 1 13.25 3h2A1.75 1.75 0 0 1 17 4.75v6.5A1.75 1.75 0 0 1 15.25 13h-2a1.75 1.75 0 0 1-1.75-1.75v-6.5Z" />
    </svg>
  )
}

function RosterIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
      <path d="M10 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3.465 14.493a1.23 1.23 0 0 0 .41 1.412A9.957 9.957 0 0 0 10 18c2.31 0 4.438-.784 6.131-2.1.43-.333.604-.903.408-1.41a7.002 7.002 0 0 0-13.074.003Z" />
    </svg>
  )
}

const SECTIONS: readonly SectionItem[] = [
  { value: 'board', label: 'Board', icon: <BoardIcon />, testId: 'section-board' },
  { value: 'roster', label: 'Roster', icon: <RosterIcon />, testId: 'section-roster' },
]

export function SectionSwitcher() {
  const activeSection = useUIStore((s) => s.activeSection)
  const setActiveSection = useUIStore((s) => s.setActiveSection)

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Sections">
      {SECTIONS.map((item) => {
        const isActive = activeSection === item.value
        return (
          <Tooltip key={item.value} content={item.label} side="bottom">
            <motion.button
              onClick={() => {
                setActiveSection(item.value)
              }}
              aria-label={item.label}
              aria-pressed={isActive}
              data-testid={item.testId}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              style={{ cursor: 'pointer' }}
              className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg ${
                isActive
                  ? 'bg-accent/15 text-accent'
                  : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
              }`}
            >
              {item.icon}
            </motion.button>
          </Tooltip>
        )
      })}
    </div>
  )
}
