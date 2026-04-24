import { memo } from 'react'
import type { Task } from '@/types'

type TaskQuickActionsProps = {
  task: Task
  hasNextColumn: boolean
  columnHasTrigger: boolean
  isDeleteConfirmPending: boolean
  onOpen: () => void
  onToggleAgent: () => void
  onRetry: () => void
  onMoveNext: () => void
  onRequestDelete: () => void
  onShowMenu: (e: React.MouseEvent) => void
}

export const TaskQuickActions = memo(function TaskQuickActions({
  task,
  hasNextColumn,
  columnHasTrigger,
  isDeleteConfirmPending,
  onOpen,
  onToggleAgent,
  onRetry,
  onMoveNext,
  onRequestDelete,
  onShowMenu,
}: TaskQuickActionsProps) {
  const isRunning = task.agentStatus === 'running'
  const hasError = !!task.pipelineError

  // Play is only meaningful when the column has a trigger; Stop is always allowed.
  const showPlay = !isRunning && columnHasTrigger
  const showStop = isRunning

  return (
    <div
      className="absolute right-1 top-1 flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity z-10"
      onClick={(e) => { e.stopPropagation(); }}
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

      {/* Run/Stop agent — Play requires a trigger column; Stop always allowed when running */}
      {(showPlay || showStop) && (
        <button
          onClick={onToggleAgent}
          className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
            isRunning
              ? 'text-running hover:bg-running/20'
              : 'text-text-secondary hover:bg-surface-hover hover:text-success'
          }`}
          title={isRunning ? 'Stop agent (Space)' : 'Run agent (Space)'}
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
      )}

      {/* Retry - visible when task has pipeline error */}
      {hasError && (
        <button
          onClick={onRetry}
          className="flex h-6 w-6 items-center justify-center rounded text-text-secondary hover:bg-warning/20 hover:text-warning transition-colors"
          title="Retry pipeline (R)"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h2.433a.75.75 0 0 0 0-1.5H4.598a.75.75 0 0 0-.75.75v3.634a.75.75 0 0 0 1.5 0v-2.033l.312.311a7 7 0 0 0 11.712-3.138.75.75 0 0 0-1.449-.39l-.611.21ZM4.688 8.576a5.5 5.5 0 0 1 9.201-2.466l.312.311h-2.433a.75.75 0 0 0 0 1.5h3.634a.75.75 0 0 0 .75-.75V3.537a.75.75 0 0 0-1.5 0v2.033l-.312-.311A7 7 0 0 0 3.628 8.397a.75.75 0 0 0 1.449.39l-.389-.211Z" clipRule="evenodd" />
          </svg>
        </button>
      )}

      {/* Move to next column */}
      {hasNextColumn && (
        <button
          onClick={onMoveNext}
          className="flex h-6 w-6 items-center justify-center rounded text-text-secondary hover:bg-surface-hover hover:text-accent transition-colors"
          title="Move to next column (→)"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M3 10a.75.75 0 0 1 .75-.75h10.638l-3.96-4.158a.75.75 0 1 1 1.085-1.034l5.25 5.5a.75.75 0 0 1 0 1.034l-5.25 5.5a.75.75 0 1 1-1.085-1.034l3.96-4.158H3.75A.75.75 0 0 1 3 10Z" clipRule="evenodd" />
          </svg>
        </button>
      )}

      {/* Delete — confirm state lives in parent so mouse + keyboard share one timer */}
      <button
        onClick={onRequestDelete}
        className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
          isDeleteConfirmPending
            ? 'text-error bg-error/20'
            : 'text-text-secondary hover:bg-error/20 hover:text-error'
        }`}
        title={isDeleteConfirmPending ? 'Click again to confirm' : 'Delete task (Del)'}
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
          <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM7.5 3.75c0-.69.56-1.25 1.25-1.25h2.5c.69 0 1.25.56 1.25 1.25V4.1a40.3 40.3 0 0 0-5 0v-.35ZM9 7.75a.75.75 0 0 0-1.5 0v6.5a.75.75 0 0 0 1.5 0v-6.5Zm3.25-.75a.75.75 0 0 1 .75.75v6.5a.75.75 0 0 1-1.5 0v-6.5a.75.75 0 0 1 .75-.75Z" clipRule="evenodd" />
        </svg>
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
