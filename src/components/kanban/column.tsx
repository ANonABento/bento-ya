import { memo, useState, useCallback, useMemo } from 'react'
import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { motion } from 'motion/react'
import type { Column as ColumnType } from '@/types'
import { useTaskStore } from '@/stores/task-store'
import { useColumnStore } from '@/stores/column-store'
import { ColumnHeader } from './column-header'
import { TaskCard } from './task-card'
import { ColumnConfigDialog } from './column-config-dialog'

type ColumnProps = {
  column: ColumnType
}

export const Column = memo(function Column({ column }: ColumnProps) {
  const allTasks = useTaskStore((s) => s.tasks)
  const remove = useColumnStore((s) => s.remove)

  // Memoize filtered tasks to prevent infinite loops
  const tasks = useMemo(
    () => allTasks
      .filter((t) => t.columnId === column.id)
      .sort((a, b) => a.position - b.position),
    [allTasks, column.id]
  )
  const taskIds = useMemo(() => tasks.map((t) => t.id), [tasks])

  const [showConfigDialog, setShowConfigDialog] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)

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

  const handleConfigure = useCallback(() => {
    setShowConfigDialog(true)
  }, [])

  const handleDelete = useCallback(() => {
    if (tasks.length > 0) {
      setShowDeleteConfirm(true)
    } else {
      remove(column.id)
    }
  }, [column.id, tasks.length, remove])

  const confirmDelete = useCallback(() => {
    remove(column.id)
    setShowDeleteConfirm(false)
  }, [column.id, remove])

  return (
    <>
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
            icon={column.icon || 'list'}
            taskCount={tasks.length}
            color={column.color}
            onConfigure={handleConfigure}
            onDelete={handleDelete}
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

      {/* Config dialog */}
      {showConfigDialog && (
        <ColumnConfigDialog
          column={column}
          onClose={() => setShowConfigDialog(false)}
        />
      )}

      {/* Delete confirmation dialog */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowDeleteConfirm(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded-xl border border-border-default bg-surface p-6 shadow-xl"
          >
            <h3 className="mb-2 text-lg font-semibold text-text-primary">
              Delete Column?
            </h3>
            <p className="mb-4 text-sm text-text-secondary">
              This column has {tasks.length} task(s). Deleting it will also remove all tasks.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="rounded-lg px-4 py-2 text-sm text-text-secondary hover:bg-surface-hover"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="rounded-lg bg-error px-4 py-2 text-sm font-medium text-white"
              >
                Delete
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </>
  )
})
