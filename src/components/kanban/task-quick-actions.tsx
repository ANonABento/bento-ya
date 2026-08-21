import { memo } from 'react'

type TaskQuickActionsProps = {
  onDelete: () => void
  onShowMenu: (e: React.MouseEvent) => void
  confirmDeletePending?: boolean
}

export const TaskQuickActions = memo(function TaskQuickActions({
  onDelete,
  onShowMenu,
  confirmDeletePending = false,
}: TaskQuickActionsProps) {
  return (
    <div
      className="absolute right-1 top-1 flex items-center gap-0.5 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto transition-opacity z-10"
      onClick={(e) => { e.stopPropagation(); }}
    >
      {confirmDeletePending && (
        <button
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          className="h-6 rounded bg-error/20 px-2 text-xs font-medium text-error transition-colors hover:bg-error/30"
          style={{ cursor: 'pointer' }}
          title="Click again to confirm"
          aria-label="Confirm delete"
        >
          Confirm
        </button>
      )}

      {/* More options */}
      <button
        onClick={onShowMenu}
        className="flex h-7 w-7 items-center justify-center rounded text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-colors"
        style={{ cursor: 'pointer' }}
        title="More actions"
        aria-label="More actions"
        aria-haspopup="menu"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path d="M10 3a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM10 8.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM11.5 15.5a1.5 1.5 0 1 0-3 0 1.5 1.5 0 0 0 3 0Z" />
        </svg>
      </button>
    </div>
  )
})
