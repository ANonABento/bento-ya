import { useEffect, useRef, useCallback, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Task, Column } from '@/types'

type MenuItem = {
  label: string
  icon?: React.ReactNode
  shortcut?: string
  onClick: () => void
  variant?: 'default' | 'danger'
  disabled?: boolean
}

type MenuDivider = { type: 'divider' }

type MenuSubmenu = {
  label: string
  icon?: React.ReactNode
  items: MenuItem[]
}

type MenuItemType = MenuItem | MenuDivider | MenuSubmenu

type TaskContextMenuProps = {
  task: Task
  columns: Column[]
  position: { x: number; y: number }
  onClose: () => void
  onMoveToColumn: (columnId: string) => void
  onOpenTask: () => void
  onDuplicateTask: () => void
  onArchiveTask: () => void
  onUnarchiveTask: () => void
  onDeleteTask: () => void
  onSaveAsTemplate: () => void
  onRunAgent: () => void
  onStopAgent: () => void
  onStartSiege: () => void
  onStopSiege: () => void
  onConfigureTask?: () => void
}

// Icons
const Icons = {
  open: (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path d="M4.25 5.5a.75.75 0 0 0-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 0 0 .75-.75v-4a.75.75 0 0 1 1.5 0v4A2.25 2.25 0 0 1 12.75 17h-8.5A2.25 2.25 0 0 1 2 14.75v-8.5A2.25 2.25 0 0 1 4.25 4h5a.75.75 0 0 1 0 1.5h-5Z" />
      <path d="M6.194 12.753a.75.75 0 0 0 1.06.053L16.5 4.44v2.81a.75.75 0 0 0 1.5 0v-4.5a.75.75 0 0 0-.75-.75h-4.5a.75.75 0 0 0 0 1.5h2.553l-9.056 8.194a.75.75 0 0 0-.053 1.06Z" />
    </svg>
  ),
  play: (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path d="M6.3 2.84A1.5 1.5 0 0 0 4 4.11v11.78a1.5 1.5 0 0 0 2.3 1.27l9.344-5.891a1.5 1.5 0 0 0 0-2.538L6.3 2.841Z" />
    </svg>
  ),
  stop: (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path d="M5.75 3A2.75 2.75 0 0 0 3 5.75v8.5A2.75 2.75 0 0 0 5.75 17h8.5A2.75 2.75 0 0 0 17 14.25v-8.5A2.75 2.75 0 0 0 14.25 3h-8.5Z" />
    </svg>
  ),
  siege: (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M10 2a4 4 0 0 0-4 4c0 1.8.86 2.76 1.72 3.22V10h.86v2.57H7v1.72h1.58V18h2.84v-3.71H13v-1.72h-1.58V10h.86v-.78c.86-.46 1.72-1.42 1.72-3.22a4 4 0 0 0-4-4Zm0 1.72a2.28 2.28 0 0 0-2.28 2.28c0 1.08.57 1.72 1.14 2V9h2.28V8c.57-.28 1.14-.92 1.14-2A2.28 2.28 0 0 0 10 3.72Z" clipRule="evenodd" />
    </svg>
  ),
  move: (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M2.232 12.207a.75.75 0 0 1 1.06.025l3.958 4.146V6.375a5.375 5.375 0 0 1 10.75 0V9.25a.75.75 0 0 1-1.5 0V6.375a3.875 3.875 0 0 0-7.75 0v10.003l3.957-4.146a.75.75 0 0 1 1.085 1.036l-5.25 5.5a.75.75 0 0 1-1.085 0l-5.25-5.5a.75.75 0 0 1 .025-1.06Z" clipRule="evenodd" />
    </svg>
  ),
  duplicate: (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path d="M7 3.5A1.5 1.5 0 0 1 8.5 2h3.879a1.5 1.5 0 0 1 1.06.44l3.122 3.12A1.5 1.5 0 0 1 17 6.622V12.5a1.5 1.5 0 0 1-1.5 1.5h-1v-3.379a3 3 0 0 0-.879-2.121L10.5 5.379A3 3 0 0 0 8.379 4.5H7v-1Z" />
      <path d="M4.5 6A1.5 1.5 0 0 0 3 7.5v9A1.5 1.5 0 0 0 4.5 18h7a1.5 1.5 0 0 0 1.5-1.5v-5.879a1.5 1.5 0 0 0-.44-1.06L9.44 6.44A1.5 1.5 0 0 0 8.378 6H4.5Z" />
    </svg>
  ),
  template: (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M4.5 3A1.5 1.5 0 0 0 3 4.5v12a1.5 1.5 0 0 0 1.5 1.5h11a1.5 1.5 0 0 0 1.5-1.5v-12A1.5 1.5 0 0 0 15.5 3h-11Zm.75 1.5h9.5a.25.25 0 0 1 .25.25v1a.25.25 0 0 1-.25.25H5.25A.25.25 0 0 1 5 4.5v-1A.25.25 0 0 1 5.25 4.5Zm.5 3h8a.5.5 0 0 1 0 1h-8a.5.5 0 0 1 0-1Zm0 3h10a.5.5 0 0 1 0 1h-10a.5.5 0 0 1 0-1Zm0 3h9a.5.5 0 0 1 0 1h-9a.5.5 0 0 1 0-1Z"
      />
    </svg>
  ),
  archive: (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path d="M2 3a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H2Z" />
      <path fillRule="evenodd" d="M2 7.5h16l-.811 7.71a2 2 0 0 1-1.99 1.79H4.802a2 2 0 0 1-1.99-1.79L2 7.5Zm5.22 1.72a.75.75 0 0 1 1.06 0L10 10.94l1.72-1.72a.75.75 0 1 1 1.06 1.06l-2.25 2.25a.75.75 0 0 1-1.06 0l-2.25-2.25a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
    </svg>
  ),
  unarchive: (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path d="M2 3a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H2Z" />
      <path fillRule="evenodd" d="M2 7.5h16l-.811 7.71a2 2 0 0 1-1.99 1.79H4.802a2 2 0 0 1-1.99-1.79L2 7.5Zm7.53 1.22a.75.75 0 0 1 1.06 0l2.25 2.25a.75.75 0 0 1-1.06 1.06L10 10.31l-1.72 1.72a.75.75 0 0 1-1.06-1.06l2.31-2.25Z" clipRule="evenodd" />
    </svg>
  ),
  trash: (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.519.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clipRule="evenodd" />
    </svg>
  ),
  configure: (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M7.84 1.804A1 1 0 0 1 8.82 1h2.36a1 1 0 0 1 .98.804l.331 1.652a6.993 6.993 0 0 1 1.929 1.115l1.598-.54a1 1 0 0 1 1.186.447l1.18 2.044a1 1 0 0 1-.205 1.251l-1.267 1.113a7.047 7.047 0 0 1 0 2.228l1.267 1.113a1 1 0 0 1 .206 1.25l-1.18 2.045a1 1 0 0 1-1.187.447l-1.598-.54a6.993 6.993 0 0 1-1.929 1.115l-.33 1.652a1 1 0 0 1-.98.804H8.82a1 1 0 0 1-.98-.804l-.331-1.652a6.993 6.993 0 0 1-1.929-1.115l-1.598.54a1 1 0 0 1-1.186-.447l-1.18-2.044a1 1 0 0 1 .205-1.251l1.267-1.114a7.05 7.05 0 0 1 0-2.227L1.821 7.773a1 1 0 0 1-.206-1.25l1.18-2.045a1 1 0 0 1 1.187-.447l1.598.54A6.993 6.993 0 0 1 7.51 3.456l.33-1.652ZM10 13a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" clipRule="evenodd" />
    </svg>
  ),
  chevronRight: (
    <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M8.22 5.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06-1.06L11.94 10 8.22 6.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
    </svg>
  ),
}

function MenuItemComponent({ item, onClose }: { item: MenuItem; onClose: () => void }) {
  const handleClick = () => {
    if (!item.disabled) {
      item.onClick()
      onClose()
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={item.disabled}
      className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition-colors ${
        item.disabled
          ? 'text-text-secondary/50 cursor-not-allowed'
          : item.variant === 'danger'
            ? 'text-error hover:bg-error/10'
            : 'text-text-primary hover:bg-surface-hover'
      }`}
    >
      {item.icon && <span className="text-text-secondary">{item.icon}</span>}
      <span className="flex-1">{item.label}</span>
      {item.shortcut && (
        <span className="text-[11px] text-text-secondary/70">{item.shortcut}</span>
      )}
    </button>
  )
}

function SubmenuComponent({
  item,
  onClose,
}: {
  item: MenuSubmenu
  onClose: () => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleMouseEnter = () => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    setIsOpen(true)
  }

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => { setIsOpen(false); }, 150)
  }

  return (
    <div
      className="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-text-primary hover:bg-surface-hover">
        {item.icon && <span className="text-text-secondary">{item.icon}</span>}
        <span className="flex-1">{item.label}</span>
        {Icons.chevronRight}
      </button>

      {isOpen && (
        <div className="absolute left-full top-0 ml-1 min-w-[160px] rounded-lg border border-border-default bg-surface p-1 shadow-xl">
          {item.items.map((subItem, idx) => (
            <MenuItemComponent key={idx} item={subItem} onClose={onClose} />
          ))}
        </div>
      )}
    </div>
  )
}

export function TaskContextMenu({
  task,
  columns,
  position,
  onClose,
  onMoveToColumn,
  onOpenTask,
  onDuplicateTask,
  onArchiveTask,
  onUnarchiveTask,
  onDeleteTask,
  onSaveAsTemplate,
  onRunAgent,
  onStopAgent,
  onStartSiege,
  onStopSiege,
  onConfigureTask,
}: TaskContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null)

  // Close on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose()
      }
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [onClose])

  // Adjust position to stay in viewport
  const adjustedPosition = useCallback(() => {
    const menuWidth = 200
    const menuHeight = 300
    const padding = 8

    let x = position.x
    let y = position.y

    if (x + menuWidth > window.innerWidth - padding) {
      x = window.innerWidth - menuWidth - padding
    }
    if (y + menuHeight > window.innerHeight - padding) {
      y = window.innerHeight - menuHeight - padding
    }

    return { x: Math.max(padding, x), y: Math.max(padding, y) }
  }, [position])

  const pos = adjustedPosition()

  const isRunning = task.agentStatus === 'running'
  const hasPr = !!task.prNumber
  const isArchived = !!task.archivedAt
  const otherColumns = columns.filter((c) => c.id !== task.columnId && c.visible)

  const menuItems: MenuItemType[] = [
    { label: 'Open task', icon: Icons.open, shortcut: '↵', onClick: onOpenTask },
    ...(onConfigureTask ? [{ label: 'Configure triggers', icon: Icons.configure, onClick: onConfigureTask }] : []),
    { type: 'divider' },
    isRunning
      ? { label: 'Stop agent', icon: Icons.stop, onClick: onStopAgent }
      : { label: 'Run agent', icon: Icons.play, shortcut: 'Space', onClick: onRunAgent },
    // Siege loop option - only show if task has a PR
    ...(hasPr ? [
      task.siegeActive
        ? { label: 'Stop siege loop', icon: Icons.stop, onClick: onStopSiege }
        : { label: 'Start siege loop', icon: Icons.siege, onClick: onStartSiege },
    ] : []),
    { type: 'divider' },
    {
      label: 'Move to...',
      icon: Icons.move,
      items: otherColumns.map((col) => ({
        label: col.name,
        onClick: () => { onMoveToColumn(col.id); },
      })),
    },
    { label: 'Save as template', icon: Icons.template, onClick: onSaveAsTemplate },
    { label: 'Duplicate', icon: Icons.duplicate, shortcut: 'D', onClick: onDuplicateTask },
    { type: 'divider' },
    isArchived
      ? { label: 'Unarchive', icon: Icons.unarchive, onClick: onUnarchiveTask }
      : { label: 'Archive', icon: Icons.archive, onClick: onArchiveTask },
    { label: 'Delete', icon: Icons.trash, variant: 'danger' as const, onClick: onDeleteTask },
  ]

  return createPortal(
    <div
      ref={menuRef}
      style={{
        position: 'fixed',
        left: pos.x,
        top: pos.y,
        zIndex: 100,
      }}
      className="min-w-[180px] rounded-lg border border-border-default bg-surface p-1 shadow-xl animate-in fade-in zoom-in-95 duration-100"
    >
      {menuItems.map((item, idx) => {
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime type narrowing for union discrimination
        if ('type' in item && item.type === 'divider') {
          return <div key={idx} className="my-1 h-px bg-border-default" />
        }
        if ('items' in item) {
          return <SubmenuComponent key={idx} item={item} onClose={onClose} />
        }
        return <MenuItemComponent key={idx} item={item as MenuItem} onClose={onClose} />
      })}
    </div>,
    document.body
  )
}
