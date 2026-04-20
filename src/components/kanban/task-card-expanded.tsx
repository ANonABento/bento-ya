import { motion } from 'motion/react'
import type { Task } from '@/types'
import { useTaskDetail } from '@/hooks/use-task-detail'
import { ChangesSection } from '@/components/task-detail/changes-section'
import { CommitsSection } from '@/components/task-detail/commits-section'
import { SiegeStatus } from '@/components/task-detail/siege-status'

const EXPANDED_MAX_HEIGHT = 400

export function TaskCardExpanded({ task }: { task: Task }) {
  const { updateTask, changes, commits, loading } = useTaskDetail(task)

  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: 'auto', opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      className="overflow-hidden"
    >
      {/* Stop propagation so clicks inside don't collapse the card */}
      <div
        className="border-t border-border-default bg-surface-hover/30 px-3 py-2 space-y-2 overflow-y-auto"
        style={{ maxHeight: EXPANDED_MAX_HEIGHT }}
        onClick={(e) => { e.stopPropagation() }}
      >
        {/* Full description */}
        {task.description && (
          <p className="text-xs leading-relaxed text-text-secondary">
            {task.description}
          </p>
        )}

        {/* Branch & status */}
        <div className="flex items-center gap-2 flex-wrap">
          {task.branch && (
            <div className="flex items-center gap-1.5">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" className="text-text-secondary shrink-0">
                <circle cx="4" cy="3" r="1.5" />
                <circle cx="8" cy="9" r="1.5" />
                <path d="M4 4.5V7.5C4 8.5 5 9 8 9M8 7.5V3" />
              </svg>
              <span className="truncate font-mono text-[11px] text-accent max-w-[180px]">
                {task.branch}
              </span>
              {task.worktreePath && (
                <span className="rounded bg-purple-500/10 px-1 py-0.5 text-[10px] font-medium text-purple-400" title={task.worktreePath}>
                  worktree
                </span>
              )}
            </div>
          )}
          {task.model && (
            <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
              {task.model}
            </span>
          )}
        </div>

        {/* Siege Loop Status (only when active) */}
        {(task.siegeActive || task.siegeIteration > 0) && (
          <div>
            <h4 className="text-[11px] font-medium uppercase tracking-wider text-text-secondary mb-1">
              Siege Loop
            </h4>
            <SiegeStatus task={task} onUpdate={updateTask} />
          </div>
        )}

        {/* Changes */}
        <div>
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-text-secondary mb-1">
            Changes
          </h4>
          <ChangesSection changes={changes} loading={loading} />
        </div>

        {/* Commits */}
        <div>
          <h4 className="text-[11px] font-medium uppercase tracking-wider text-text-secondary mb-1">
            Commits
          </h4>
          <CommitsSection commits={commits} />
        </div>

      </div>
    </motion.div>
  )
}
