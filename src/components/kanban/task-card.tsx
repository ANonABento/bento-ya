import { memo } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { motion } from 'motion/react'
import type { Task } from '@/types'
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

  return (
    <motion.div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{
        opacity: isDragging ? 0.5 : 1,
        scale: 1,
      }}
      whileHover={{ y: -2, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}
      transition={{ type: 'spring', stiffness: 400, damping: 28 }}
      onClick={handleClick}
      className={`relative cursor-grab rounded-xl border bg-surface p-3 active:cursor-grabbing ${
        needsAttention
          ? 'border-attention/50 animate-attention-pulse'
          : 'border-border-default'
      }`}
    >
      {/* Attention badge */}
      {needsAttention && attention && (
        <div className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-attention px-1 text-[10px] font-bold text-bg">
          {attention.reason === 'question' ? '?' : attention.reason === 'error' ? '!' : '•'}
        </div>
      )}

      <div className="flex items-start justify-between gap-2">
        <h4 className="text-sm font-medium text-text-primary leading-snug">
          {task.title}
        </h4>
        {task.agentStatus && (
          <Badge
            variant={statusVariant[task.agentStatus]}
            className="shrink-0 mt-0.5"
          />
        )}
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

      <div className="mt-2 flex items-center gap-2 text-xs text-text-secondary">
        {task.agentType && (
          <span className="rounded bg-surface-hover px-1.5 py-0.5">
            {task.agentType}
          </span>
        )}
        {task.branch && (
          <span className="truncate font-mono text-[11px]">{task.branch}</span>
        )}
      </div>
    </motion.div>
  )
})
