import { memo } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { motion } from 'motion/react'
import type { Task, PipelineState } from '@/types'
import { Badge } from '@/components/shared/badge'
import { useUIStore } from '@/stores/ui-store'
import { useAttentionStore, ATTENTION_LABELS } from '@/stores/attention-store'

type TaskCardProps = {
  task: Task
}

const statusVariant = {
  running: 'running' as const,
  completed: 'success' as const,
  failed: 'error' as const,
  stopped: 'default' as const,
  needs_attention: 'attention' as const,
}

const PIPELINE_LABELS: Record<PipelineState, string> = {
  idle: '',
  triggered: 'Starting...',
  running: 'Running',
  evaluating: 'Checking...',
  advancing: 'Moving...',
}

const ATTENTION_ICONS: Record<string, string> = {
  question: '?',
  error: '!',
  default: '•',
}


export const TaskCard = memo(function TaskCard({ task }: TaskCardProps) {
  const openTask = useUIStore((s) => s.openTask)
  const hasAttention = useAttentionStore((s) => s.hasAttention(task.id))
  const attention = useAttentionStore((s) => s.getAttention(task.id))
  const markViewed = useAttentionStore((s) => s.markViewed)

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    data: { type: 'task' },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  function handleClick() {
    // Mark attention as viewed when card is clicked
    if (hasAttention) {
      markViewed(task.id)
    }
    openTask(task.id)
  }

  const needsAttention = hasAttention || task.agentStatus === 'needs_attention'
  const isPipelineActive = task.pipelineState !== 'idle'
  const hasPipelineError = !!task.pipelineError

  // Determine border style based on state
  const borderClass = hasPipelineError
    ? 'border-error/50'
    : needsAttention
      ? 'border-attention/50 animate-attention-pulse'
      : isPipelineActive
        ? 'border-running/50'
        : 'border-border-default'

  return (
    <motion.div
      ref={setNodeRef}
      style={{
        ...style,
        cursor: 'pointer',
      }}
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{
        opacity: isDragging ? 0.5 : 1,
        scale: 1,
      }}
      whileHover={{ y: -2, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}
      transition={{ type: 'spring', stiffness: 400, damping: 28 }}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          handleClick()
        }
      }}
      tabIndex={0}
      className={`group relative rounded-lg border bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg ${borderClass}`}
    >
      {/* Drag handle - visible grip on hover */}
      <div
        {...attributes}
        {...listeners}
        className="flex h-4 items-center justify-center rounded-t-lg transition-colors group-hover:bg-surface-hover/50"
        style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        onClick={(e) => { e.stopPropagation() }}
      >
        <div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-60">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <span key={i} className="h-1 w-1 rounded-full bg-text-secondary" />
          ))}
        </div>
      </div>

      {/* Card content */}
      <div className="px-3 pb-3">
        {/* Header row with title, attention badge, and status */}
        <div className="flex items-start justify-between gap-2">
          <h4 className="text-sm font-medium text-text-primary leading-snug line-clamp-2 flex-1">
            {task.title}
          </h4>
          <div className="flex items-center gap-1.5 shrink-0">
            {needsAttention && attention && (
              <span className="flex h-5 min-w-5 items-center justify-center rounded bg-attention px-1 text-[10px] font-bold text-bg">
                {ATTENTION_ICONS[attention.reason] || ATTENTION_ICONS.default}
              </span>
            )}
            {task.agentStatus && <Badge variant={statusVariant[task.agentStatus]} />}
          </div>
        </div>

        {/* Attention reason label */}
        {needsAttention && attention && (
          <div className="mt-2 flex items-center gap-1 text-xs text-attention">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
              <path fillRule="evenodd" d="M6.701 2.25c.577-1 2.02-1 2.598 0l5.196 9a1.5 1.5 0 0 1-1.299 2.25H2.804a1.5 1.5 0 0 1-1.3-2.25l5.197-9ZM8 5a.75.75 0 0 1 .75.75v2.5a.75.75 0 0 1-1.5 0v-2.5A.75.75 0 0 1 8 5Zm0 6a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
            </svg>
            {ATTENTION_LABELS[attention.reason]}
          </div>
        )}

        {/* Pipeline error - elevated banner style */}
        {hasPipelineError && (
          <div className="mt-2 rounded bg-error/10 border border-error/20 px-2 py-1.5">
            <div className="flex items-start gap-1.5 text-xs text-error">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5 shrink-0 mt-0.5">
                <path fillRule="evenodd" d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14Zm.75-8.25a.75.75 0 0 0-1.5 0v3.5a.75.75 0 0 0 1.5 0v-3.5ZM8 12a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
              </svg>
              <span className="line-clamp-2">{task.pipelineError}</span>
            </div>
          </div>
        )}

        {/* Metadata footer */}
        <div className="mt-3 pt-2 border-t border-border-default/50 flex items-center justify-between gap-2 text-xs text-text-secondary">
          <div className="flex items-center gap-2">
            {task.agentType && (
              <span className="rounded bg-surface-hover px-1.5 py-0.5">
                {task.agentType}
              </span>
            )}
            {task.branch && (
              <span className="truncate font-mono text-[11px]">{task.branch}</span>
            )}
          </div>

          {/* Pipeline state indicator */}
          {isPipelineActive && !hasPipelineError && (
            <div className="flex items-center gap-1.5 text-running">
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-running opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-running" />
              </span>
              <span className="text-[11px]">{PIPELINE_LABELS[task.pipelineState]}</span>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  )
})
