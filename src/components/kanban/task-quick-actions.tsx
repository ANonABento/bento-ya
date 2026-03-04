import { memo } from 'react'
import type { Task } from '@/types'

type TaskQuickActionsProps = {
  task: Task
  onOpen: () => void
  onToggleAgent: () => void
  onShowMenu: (e: React.MouseEvent) => void
}

export const TaskQuickActions = memo(function TaskQuickActions({
  task,
  onOpen,
  onToggleAgent,
  onShowMenu,
}: TaskQuickActionsProps) {
  const isRunning = task.agentStatus === 'running'

  return (
    <div
      className="absolute right-1 top-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Open in panel */}
      <button
        onClick={onOpen}
        className="flex h-6 w-6 items-center justify-center rounded text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-colors"
        title="Open task"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
          <path d="M4.25 5.5a.75.75 0 0 0-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 0 0 .75-.75v-4a.75.75 0 0 1 1.5 0v4A2.25 2.25 0 0 1 12.75 17h-8.5A2.25 2.25 0 0 1 2 14.75v-8.5A2.25 2.25 0 0 1 4.25 4h5a.75.75 0 0 1 0 1.5h-5Z" />
          <path d="M6.194 12.753a.75.75 0 0 0 1.06.053L16.5 4.44v2.81a.75.75 0 0 0 1.5 0v-4.5a.75.75 0 0 0-.75-.75h-4.5a.75.75 0 0 0 0 1.5h2.553l-9.056 8.194a.75.75 0 0 0-.053 1.06Z" />
        </svg>
      </button>

      {/* Run/Stop agent */}
      <button
        onClick={onToggleAgent}
        className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
          isRunning
            ? 'text-running hover:bg-running/20'
            : 'text-text-secondary hover:bg-surface-hover hover:text-success'
        }`}
        title={isRunning ? 'Stop agent' : 'Run agent'}
      >
        {isRunning ? (
          <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
            <path d="M5.75 3A2.75 2.75 0 0 0 3 5.75v8.5A2.75 2.75 0 0 0 5.75 17h8.5A2.75 2.75 0 0 0 17 14.25v-8.5A2.75 2.75 0 0 0 14.25 3h-8.5Z" />
          </svg>
        ) : (
          <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
            <path d="M6.3 2.84A1.5 1.5 0 0 0 4 4.11v11.78a1.5 1.5 0 0 0 2.3 1.27l9.344-5.891a1.5 1.5 0 0 0 0-2.538L6.3 2.841Z" />
          </svg>
        )}
      </button>

      {/* More options */}
      <button
        onClick={onShowMenu}
        className="flex h-6 w-6 items-center justify-center rounded text-text-secondary hover:bg-surface-hover hover:text-text-primary transition-colors"
        title="More actions"
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
          <path d="M10 3a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM10 8.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3ZM11.5 15.5a1.5 1.5 0 1 0-3 0 1.5 1.5 0 0 0 3 0Z" />
        </svg>
      </button>
    </div>
  )
})
