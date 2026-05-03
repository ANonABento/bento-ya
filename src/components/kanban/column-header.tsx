import { memo, useState, useRef, useEffect, type ChangeEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { motion } from 'motion/react'
import { IconButton } from '@/components/shared/icon-button'
import { Tooltip } from '@/components/shared/tooltip'
import type { ColumnMetrics } from '@/lib/ipc/pipeline'

type ScriptTriggerInfo = {
  scriptName: string
  event: 'entry' | 'exit' | 'both'
}

type BatchQueueState = {
  total: number
  completed: number
}

type ColumnHeaderProps = {
  name: string
  icon: string
  taskCount: number
  color: string
  scriptTrigger?: ScriptTriggerInfo
  isBacklog?: boolean
  batchQueue?: BatchQueueState
  metrics?: ColumnMetrics
  onConfigure: () => void
  onAddTask: () => void
  onRenameSubmit: (name: string) => void
  onRunAll?: () => void
  onCancelQueue?: () => void
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${String(Math.round(seconds))}s`
  if (seconds < 3600) return `${String(Math.round(seconds / 60))}m`
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  if (m === 0) return `${String(h)}h`
  return `${String(h)}h ${String(m)}m`
}

function successRatePct(m: ColumnMetrics): number {
  return Math.round((m.successCount / m.taskCount) * 100)
}

function buildMetricsTooltip(m: ColumnMetrics): string {
  const duration = formatDuration(m.avgDurationSeconds)
  const rate = successRatePct(m)
  const throughput = m.throughputPerDay.toFixed(1)
  return [
    `Avg time: ${duration}`,
    `Success rate: ${String(rate)}% (${String(m.successCount)}/${String(m.taskCount)} tasks)`,
    `Throughput: ${throughput} tasks/day`,
    `(last 30 days)`,
  ].join('\n')
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
  scriptTrigger,
  isBacklog,
  batchQueue,
  metrics,
  onConfigure,
  onAddTask,
  onRenameSubmit,
  onRunAll,
  onCancelQueue,
}: ColumnHeaderProps) {
  const [showConfirm, setShowConfirm] = useState(false)
  const [isRenaming, setIsRenaming] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [metricsExpanded, setMetricsExpanded] = useState(false)
  const renameInputRef = useRef<HTMLInputElement>(null)
  // Prevents blur from submitting after Enter or Escape already resolved the rename
  const renameResolvedRef = useRef<boolean>(false)

  useEffect(() => {
    if (isRenaming) {
      renameResolvedRef.current = false
      renameInputRef.current?.focus()
      renameInputRef.current?.select()
    }
  }, [isRenaming])

  const handleNameDoubleClick = () => {
    setRenameValue(name)
    setIsRenaming(true)
  }

  const submitRename = () => {
    if (renameResolvedRef.current) return
    renameResolvedRef.current = true
    const trimmed = renameValue.trim()
    if (trimmed && trimmed !== name) {
      onRenameSubmit(trimmed)
    }
    setIsRenaming(false)
  }

  const cancelRename = () => {
    if (renameResolvedRef.current) return
    renameResolvedRef.current = true
    setIsRenaming(false)
  }

  const handleRenameChange = (e: ChangeEvent<HTMLInputElement>) => {
    setRenameValue(e.target.value)
  }

  const handleRenameKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') { e.preventDefault(); submitRename() }
    if (e.key === 'Escape') { e.preventDefault(); cancelRename() }
  }

  const stopInputPropagation = (e: ReactMouseEvent) => {
    e.stopPropagation()
  }

  const handleRunAllClick = () => {
    setShowConfirm(true)
  }

  const handleConfirmRunAll = () => {
    setShowConfirm(false)
    onRunAll?.()
  }

  return (
    <>
      <div className="flex items-center gap-2 px-3 py-2">
        <span
          className="flex h-5 w-5 items-center justify-center rounded text-text-secondary"
          style={{ color: color || 'var(--accent)' }}
        >
          {getIcon(icon)}
        </span>
        <span className="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] font-medium text-text-secondary tabular-nums">
          {taskCount}
        </span>
        {isRenaming ? (
          <input
            ref={renameInputRef}
            type="text"
            value={renameValue}
            onChange={handleRenameChange}
            onBlur={submitRename}
            onKeyDown={handleRenameKeyDown}
            onMouseDown={stopInputPropagation}
            onClick={stopInputPropagation}
            className="min-w-0 flex-1 bg-transparent text-xs font-semibold uppercase tracking-wider text-text-primary outline-none border-b border-accent pb-px"
          />
        ) : (
          <h3
            className="min-w-0 flex-1 text-xs font-semibold uppercase tracking-wider text-text-secondary truncate cursor-default select-none"
            onDoubleClick={handleNameDoubleClick}
          >
            {name}
          </h3>
        )}

        {/* Column metrics — compact icon, hover for tooltip, click to expand inline */}
        {metrics && metrics.taskCount > 0 && (
          metricsExpanded ? (
            <Tooltip content={buildMetricsTooltip(metrics)} side="bottom" wrap>
              <button
                type="button"
                onClick={() => { setMetricsExpanded(false) }}
                className="flex items-center gap-1 rounded text-[10px] text-text-secondary/60 tabular-nums whitespace-nowrap hover:text-text-secondary"
              >
                <span>⏱{formatDuration(metrics.avgDurationSeconds)}</span>
                <span className="text-text-secondary/30">·</span>
                <span>✓{successRatePct(metrics)}%</span>
                <span className="text-text-secondary/30">·</span>
                <span>{metrics.throughputPerDay.toFixed(1)}/d</span>
              </button>
            </Tooltip>
          ) : (
            <Tooltip content={buildMetricsTooltip(metrics)} side="bottom" wrap>
              <button
                type="button"
                onClick={() => { setMetricsExpanded(true) }}
                aria-label="Show column metrics"
                className="flex h-4 w-4 items-center justify-center rounded text-text-secondary/50 hover:bg-surface-hover hover:text-text-secondary"
              >
                <svg viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                  <path d="M2 13.5V8.5h2.5v5H2Zm4.75 0v-9h2.5v9h-2.5Zm4.75 0v-7H14v7h-2.5Z" />
                </svg>
              </button>
            </Tooltip>
          )
        )}

        {scriptTrigger && (
          <span
            className="truncate rounded bg-purple-500/10 px-1.5 py-0.5 text-[10px] font-medium text-purple-400"
            title={`Script: ${scriptTrigger.scriptName} (${scriptTrigger.event === 'both' ? 'entry + exit' : `on ${scriptTrigger.event}`})`}
          >
            {scriptTrigger.scriptName}
          </span>
        )}

        {/* Batch queue progress badge */}
        {batchQueue && (
          <span className="rounded bg-accent/15 px-1.5 py-0.5 text-[10px] font-medium text-accent">
            Queued: {batchQueue.completed}/{batchQueue.total}
          </span>
        )}

        <div className="ml-auto flex items-center gap-0.5">
          {/* Run All button (backlog only, when tasks exist and not already queuing) */}
          {isBacklog && taskCount > 0 && !batchQueue && (
            <IconButton
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                  <path d="M2 4.5A2.5 2.5 0 0 1 4.5 2h2.879a2.5 2.5 0 0 1 1.767.732l4.122 4.122a2.5 2.5 0 0 1 0 3.536l-2.879 2.878a2.5 2.5 0 0 1-3.536 0L2.731 9.146A2.5 2.5 0 0 1 2 7.38V4.5ZM5.5 5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1Z" />
                </svg>
              }
              onClick={handleRunAllClick}
              tooltip="Run All"
              tooltipSide="bottom"
            />
          )}

          {/* Cancel queue button */}
          {batchQueue && (
            <IconButton
              icon={
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                  <path fillRule="evenodd" d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14Zm2.78-4.22a.75.75 0 0 1-1.06 0L8 9.06l-1.72 1.72a.75.75 0 1 1-1.06-1.06L6.94 8 5.22 6.28a.75.75 0 0 1 1.06-1.06L8 6.94l1.72-1.72a.75.75 0 1 1 1.06 1.06L9.06 8l1.72 1.72a.75.75 0 0 1 0 1.06Z" clipRule="evenodd" />
                </svg>
              }
              onClick={onCancelQueue}
              tooltip="Cancel queue"
              tooltipSide="bottom"
            />
          )}

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

          {/* Configure button (single click — Delete moved into the config dialog) */}
          <IconButton
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
                <path fillRule="evenodd" d="M6.455 1.45A.5.5 0 0 1 6.952 1h2.096a.5.5 0 0 1 .497.45l.186 1.858a4.996 4.996 0 0 1 1.466.848l1.703-.769a.5.5 0 0 1 .639.206l1.048 1.814a.5.5 0 0 1-.142.656l-1.517 1.09a5.026 5.026 0 0 1 0 1.694l1.517 1.09a.5.5 0 0 1 .142.656l-1.048 1.814a.5.5 0 0 1-.639.206l-1.703-.769c-.433.36-.928.649-1.466.848l-.186 1.858a.5.5 0 0 1-.497.45H6.952a.5.5 0 0 1-.497-.45l-.186-1.858a4.993 4.993 0 0 1-1.466-.848l-1.703.769a.5.5 0 0 1-.639-.206L1.413 10.4a.5.5 0 0 1 .142-.656l1.517-1.09a5.026 5.026 0 0 1 0-1.694l-1.517-1.09a.5.5 0 0 1-.142-.656L2.46 3.4a.5.5 0 0 1 .639-.206l1.703.769c.433-.36.928-.649 1.466-.848l.186-1.858ZM8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" clipRule="evenodd" />
              </svg>
            }
            onClick={onConfigure}
            tooltip="Configure column"
            tooltipSide="bottom"
          />
        </div>
      </div>

      {/* Run All confirmation dialog */}
      {showConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => { setShowConfirm(false); }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={(e) => { e.stopPropagation(); }}
            className="w-full max-w-sm rounded border border-border-default bg-surface p-6 shadow-xl"
          >
            <h3 className="mb-2 text-lg font-semibold text-text-primary">
              Queue {taskCount} tasks?
            </h3>
            <p className="mb-4 text-sm text-text-secondary">
              This will queue all {taskCount} task{taskCount !== 1 ? 's' : ''} in {name} for sequential pipeline processing.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowConfirm(false); }}
                className="rounded px-4 py-2 text-sm text-text-secondary hover:bg-surface-hover"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmRunAll}
                className="rounded bg-accent px-4 py-2 text-sm font-medium text-bg"
              >
                Run All
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </>
  )
})
