import { motion } from 'motion/react'
import { useEffect, useRef, useState } from 'react'
import type { Task } from '@/types'
import { useTaskDetail } from '@/hooks/use-task-detail'
import * as ipc from '@/lib/ipc'
import { ChangesSection } from '@/components/task-detail/changes-section'
import { CommitsSection } from '@/components/task-detail/commits-section'
import { SiegeStatus } from '@/components/task-detail/siege-status'

const EXPANDED_MAX_HEIGHT = 400

function formatHours(hours: number) {
  if (hours === 0) return '0h'
  if (hours < 0.1) return '<0.1h'
  return `${hours.toFixed(hours < 10 ? 1 : 0)}h`
}

function TimeTrackingSection({
  task,
  onUpdate,
}: {
  task: Task
  onUpdate: (id: string, updates: Partial<Task>) => void
}) {
  const [estimateInput, setEstimateInput] = useState(
    task.estimatedHours == null ? '' : String(task.estimatedHours),
  )
  const [saving, setSaving] = useState(false)
  const skipNextBlurSave = useRef(false)

  useEffect(() => {
    setEstimateInput(task.estimatedHours == null ? '' : String(task.estimatedHours))
  }, [task.estimatedHours])

  const estimatedHours = task.estimatedHours
  const actualHours = task.actualHours ?? 0
  const estimateInputId = `task-${task.id}-estimated-hours`
  const overEstimate = estimatedHours != null && estimatedHours > 0 && actualHours > estimatedHours * 2

  async function saveEstimate() {
    const trimmed = estimateInput.trim()
    const parsedEstimate = trimmed === '' ? null : Number(trimmed)
    if (parsedEstimate != null && (!Number.isFinite(parsedEstimate) || parsedEstimate < 0)) {
      setEstimateInput(task.estimatedHours == null ? '' : String(task.estimatedHours))
      return
    }
    const nextEstimate: number | null = parsedEstimate
    if (nextEstimate === task.estimatedHours) return

    setSaving(true)
    try {
      const updated = await ipc.updateTask(task.id, { estimatedHours: nextEstimate })
      onUpdate(task.id, updated)
    } catch (err) {
      console.error('Failed to save task estimate:', err)
      setEstimateInput(task.estimatedHours == null ? '' : String(task.estimatedHours))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rounded-md border border-border-default bg-surface px-2.5 py-2">
      <div className="grid grid-cols-2 gap-2">
        <label htmlFor={estimateInputId} className="flex min-w-0 flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-text-secondary">
            Estimate
          </span>
          <div className="flex items-center gap-1">
            <input
              id={estimateInputId}
              aria-label="Estimate"
              type="number"
              min="0"
              step="0.25"
              value={estimateInput}
              disabled={saving}
              onChange={(e) => { setEstimateInput(e.target.value) }}
              onBlur={() => {
                if (skipNextBlurSave.current) {
                  skipNextBlurSave.current = false
                  return
                }
                void saveEstimate()
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') {
                  skipNextBlurSave.current = true
                  setEstimateInput(task.estimatedHours == null ? '' : String(task.estimatedHours))
                  e.currentTarget.blur()
                }
              }}
              className="h-7 w-full rounded-md border border-border-default bg-surface-hover px-2 text-xs text-text-primary outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/20 disabled:opacity-60"
              placeholder="0"
            />
            <span className="text-xs text-text-secondary">h</span>
          </div>
        </label>
        <div className="flex min-w-0 flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-text-secondary">
            Actual
          </span>
          <div className={`flex h-7 items-center rounded-md border px-2 text-xs font-medium ${
            overEstimate
              ? 'border-amber-500/40 bg-amber-500/10 text-amber-300'
              : 'border-border-default bg-surface-hover text-text-primary'
          }`}
          >
            {formatHours(actualHours)}
          </div>
        </div>
      </div>
      {overEstimate && (
        <div className="mt-2 rounded-md bg-amber-500/10 px-2 py-1 text-[11px] text-amber-300">
          Actual time is more than 2x the estimate.
        </div>
      )}
    </div>
  )
}

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

        <TimeTrackingSection task={task} onUpdate={updateTask} />

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
