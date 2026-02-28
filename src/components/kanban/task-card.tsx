import { memo } from 'react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { motion } from 'motion/react'
import type { Task } from '@/types'
import { Badge } from '@/components/shared/badge'
import { useUIStore } from '@/stores/ui-store'

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
    openTask(task.id)
  }

  return (
    <motion.div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      layout
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: isDragging ? 0.5 : 1, scale: 1 }}
      whileHover={{ y: -2, boxShadow: '0 4px 12px rgba(0,0,0,0.3)' }}
      transition={{ type: 'spring', stiffness: 400, damping: 28 }}
      onClick={handleClick}
      className="cursor-grab rounded-xl border border-border-default bg-surface p-3 active:cursor-grabbing"
    >
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
