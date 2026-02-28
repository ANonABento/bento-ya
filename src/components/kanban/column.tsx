import { memo } from 'react'
import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { motion } from 'motion/react'
import type { Column as ColumnType } from '@/types'
import { useTaskStore } from '@/stores/task-store'
import { ColumnHeader } from './column-header'
import { TaskCard } from './task-card'

type ColumnProps = {
  column: ColumnType
}

export const Column = memo(function Column({ column }: ColumnProps) {
  const tasks = useTaskStore((s) => s.getByColumn(column.id))
  const taskIds = tasks.map((t) => t.id)

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: column.id,
    data: { type: 'column' },
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  }

  return (
    <motion.div
      ref={setNodeRef}
      style={style}
      layout
      className={`flex w-[300px] min-w-[280px] max-w-[360px] shrink-0 flex-col rounded-xl bg-surface/50 ${
        isDragging ? 'opacity-50' : ''
      }`}
    >
      <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing">
        <ColumnHeader
          name={column.name}
          taskCount={tasks.length}
          color={column.color}
        />
      </div>

      <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
        <div className="flex flex-1 flex-col gap-2 overflow-y-auto px-2 pb-2">
          {tasks.length === 0 ? (
            <p className="py-8 text-center text-xs text-text-secondary/50">
              No tasks
            </p>
          ) : (
            tasks.map((task) => <TaskCard key={task.id} task={task} />)
          )}
        </div>
      </SortableContext>
    </motion.div>
  )
})
