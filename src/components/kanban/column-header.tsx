import { memo, useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { IconButton } from '@/components/shared/icon-button'

type ColumnHeaderProps = {
  name: string
  icon: string
  taskCount: number
  color: string
  onConfigure: () => void
  onDelete: () => void
  onAddTask: () => void
}

// Icon components
function getIcon(icon: string) {
  switch (icon) {
    case 'inbox':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
          <path fillRule="evenodd" d="M2 4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4Zm2.22 1.47a.75.75 0 0 0 0 1.06l2.25 2.25a.75.75 0 0 0 1.06 0l2.25-2.25a.75.75 0 0 0-1.06-1.06L8 6.19 7.28 5.47a.75.75 0 0 0-1.06 0l-.72.72Z" clipRule="evenodd" />
        </svg>
      )
    case 'play':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
          <path d="M3 3.732a1.5 1.5 0 0 1 2.305-1.265l6.706 4.267a1.5 1.5 0 0 1 0 2.531l-6.706 4.268A1.5 1.5 0 0 1 3 12.267V3.732Z" />
        </svg>
      )
    case 'code':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
          <path fillRule="evenodd" d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
          <path fillRule="evenodd" d="M9.78 4.22a.75.75 0 0 1 0 1.06L7.06 8l2.72 2.72a.75.75 0 1 1-1.06 1.06L5.47 8.53a.75.75 0 0 1 0-1.06l3.25-3.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
        </svg>
      )
    case 'check':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
          <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
        </svg>
      )
    case 'eye':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
          <path d="M8 9.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z" />
          <path fillRule="evenodd" d="M1.38 8.28a.87.87 0 0 1 0-.566 7.003 7.003 0 0 1 13.238.006.87.87 0 0 1 0 .566A7.003 7.003 0 0 1 1.379 8.28ZM11 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" clipRule="evenodd" />
        </svg>
      )
    case 'rocket':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
          <path fillRule="evenodd" d="M9.808 1.69a.75.75 0 0 1 .712.298l3.5 4.5a.75.75 0 0 1-.988 1.122l-1.677-1.31-3.042 5.377-1.5-1.5a.75.75 0 0 0-1.06 0l-2.47 2.47a.75.75 0 1 1-1.06-1.06l3-3a.75.75 0 0 1 1.06 0l1.5 1.5L10.5 4.4l-1.56-1.22a.75.75 0 0 1 .868-1.49Z" clipRule="evenodd" />
        </svg>
      )
    case 'archive':
      return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
          <path d="M2 3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3Z" />
          <path fillRule="evenodd" d="M13 6H3v5a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2V6ZM5.72 7.47a.75.75 0 0 1 1.06 0L8 8.69l1.22-1.22a.75.75 0 1 1 1.06 1.06l-1.75 1.75a.75.75 0 0 1-1.06 0L5.72 8.53a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
        </svg>
      )
    default: // list
      return (
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
          <path fillRule="evenodd" d="M2.5 3.5c0-.56.44-1 1-1h9a1 1 0 1 1 0 2h-9a1 1 0 0 1-1-1ZM2.5 8c0-.56.44-1 1-1h9a1 1 0 1 1 0 2h-9a1 1 0 0 1-1-1ZM3.5 11.5a1 1 0 1 0 0 2h9a1 1 0 1 0 0-2h-9Z" clipRule="evenodd" />
        </svg>
      )
  }
}

export const ColumnHeader = memo(function ColumnHeader({
  name,
  icon,
  taskCount,
  color,
  onConfigure,
  onDelete,
  onAddTask,
}: ColumnHeaderProps) {
  const [showMenu, setShowMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Close menu when clicking outside
  useEffect(() => {
    if (!showMenu) return
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => { document.removeEventListener('mousedown', handleClick); }
  }, [showMenu])

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <span
        className="flex h-5 w-5 items-center justify-center rounded text-text-secondary"
        style={{ color: color || 'var(--accent)' }}
      >
        {getIcon(icon)}
      </span>
      <h3 className="text-xs font-semibold uppercase tracking-wider text-text-secondary truncate">
        {name}
      </h3>
      <span className="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
        {taskCount}
      </span>

      <div className="ml-auto flex items-center gap-0.5">
        {/* Add task button */}
        <IconButton
          icon={
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
              <path d="M8.75 3.75a.75.75 0 0 0-1.5 0v3.5h-3.5a.75.75 0 0 0 0 1.5h3.5v3.5a.75.75 0 0 0 1.5 0v-3.5h3.5a.75.75 0 0 0 0-1.5h-3.5v-3.5Z" />
            </svg>
          }
          onClick={onAddTask}
          tooltip="Add task"
          tooltipSide="bottom"
        />

        {/* Menu button */}
        <div className="relative" ref={menuRef}>
          <IconButton
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
                <path d="M8 2a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM8 6.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM9.5 12.5a1.5 1.5 0 1 0-3 0 1.5 1.5 0 0 0 3 0Z" />
              </svg>
            }
            onClick={() => { setShowMenu(!showMenu); }}
            tooltip="Column options"
            tooltipSide="bottom"
          />

          <AnimatePresence>
            {showMenu && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95, y: -5 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: -5 }}
                transition={{ duration: 0.1 }}
                className="absolute right-0 top-full z-50 mt-1 w-40 rounded border border-border-default bg-surface py-1 shadow-lg"
              >
                <button
                  onClick={() => {
                    setShowMenu(false)
                    onConfigure()
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
                    <path fillRule="evenodd" d="M6.455 1.45A.5.5 0 0 1 6.952 1h2.096a.5.5 0 0 1 .497.45l.186 1.858a4.996 4.996 0 0 1 1.466.848l1.703-.769a.5.5 0 0 1 .639.206l1.048 1.814a.5.5 0 0 1-.142.656l-1.517 1.09a5.026 5.026 0 0 1 0 1.694l1.517 1.09a.5.5 0 0 1 .142.656l-1.048 1.814a.5.5 0 0 1-.639.206l-1.703-.769c-.433.36-.928.649-1.466.848l-.186 1.858a.5.5 0 0 1-.497.45H6.952a.5.5 0 0 1-.497-.45l-.186-1.858a4.993 4.993 0 0 1-1.466-.848l-1.703.769a.5.5 0 0 1-.639-.206L1.413 10.4a.5.5 0 0 1 .142-.656l1.517-1.09a5.026 5.026 0 0 1 0-1.694l-1.517-1.09a.5.5 0 0 1-.142-.656L2.46 3.4a.5.5 0 0 1 .639-.206l1.703.769c.433-.36.928-.649 1.466-.848l.186-1.858ZM8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" clipRule="evenodd" />
                  </svg>
                  Configure
                </button>
                <button
                  onClick={() => {
                    setShowMenu(false)
                    onDelete()
                  }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-error hover:bg-error/10"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
                    <path fillRule="evenodd" d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 8.15A1.5 1.5 0 0 0 5.357 15h5.285a1.5 1.5 0 0 0 1.493-1.35l.815-8.15h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25Zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5ZM6.05 6a.75.75 0 0 1 .787.713l.275 5.5a.75.75 0 0 1-1.498.075l-.275-5.5A.75.75 0 0 1 6.05 6Zm3.9 0a.75.75 0 0 1 .712.787l-.275 5.5a.75.75 0 0 1-1.498-.075l.275-5.5a.75.75 0 0 1 .786-.711Z" clipRule="evenodd" />
                  </svg>
                  Delete
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
})
