import { useState, useCallback } from 'react'
import type {
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
  UniqueIdentifier,
} from '@dnd-kit/core'
import { arrayMove } from '@dnd-kit/sortable'
import { useColumnStore } from '@/stores/column-store'
import { useTaskStore } from '@/stores/task-store'

type ActiveItem =
  | { type: 'column'; id: string }
  | { type: 'task'; id: string }

export function useDnd() {
  const [activeItem, setActiveItem] = useState<ActiveItem | null>(null)
  const columns = useColumnStore((s) => s.columns)
  const reorderColumns = useColumnStore((s) => s.reorder)
  const tasks = useTaskStore((s) => s.tasks)
  const moveTask = useTaskStore((s) => s.move)
  const reorderTasks = useTaskStore((s) => s.reorder)

  const findColumnOfTask = useCallback(
    (taskId: UniqueIdentifier): string | undefined => {
      return tasks.find((t) => t.id === taskId)?.columnId
    },
    [tasks],
  )

  const onDragStart = useCallback((event: DragStartEvent) => {
    const { active } = event
    const data = active.data.current as { type: 'column' | 'task' } | undefined

    if (data?.type === 'column') {
      setActiveItem({ type: 'column', id: String(active.id) })
    } else {
      setActiveItem({ type: 'task', id: String(active.id) })
    }
  }, [])

  const onDragOver = useCallback(
    (event: DragOverEvent) => {
      const { active, over } = event
      if (!over) return

      const activeData = active.data.current as { type: string } | undefined
      if (activeData?.type === 'column') return

      const activeTaskId = String(active.id)
      const overId = String(over.id)

      const activeColumn = findColumnOfTask(activeTaskId)
      const overData = over.data.current as { type: string } | undefined
      const overColumn =
        overData?.type === 'column' ? overId : findColumnOfTask(overId)

      if (!activeColumn || !overColumn || activeColumn === overColumn) return

      // Moving task to a different column
      const overColumnTasks = tasks
        .filter((t) => t.columnId === overColumn)
        .sort((a, b) => a.position - b.position)

      const overIndex = overColumnTasks.findIndex((t) => t.id === overId)
      const newPosition = overIndex >= 0 ? overIndex : overColumnTasks.length

      void moveTask(activeTaskId, overColumn, newPosition)
    },
    [findColumnOfTask, tasks, moveTask],
  )

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveItem(null)
      const { active, over } = event
      if (!over || active.id === over.id) return

      const activeData = active.data.current as { type: string } | undefined

      if (activeData?.type === 'column') {
        // Reorder columns
        const columnIds = columns
          .slice()
          .sort((a, b) => a.position - b.position)
          .map((c) => c.id)
        const oldIndex = columnIds.indexOf(String(active.id))
        const newIndex = columnIds.indexOf(String(over.id))
        if (oldIndex !== -1 && newIndex !== -1) {
          const workspaceId = columns[0]?.workspaceId
          if (workspaceId) {
            void reorderColumns(workspaceId, arrayMove(columnIds, oldIndex, newIndex))
          }
        }
      } else {
        // Reorder tasks within same column
        const columnId = findColumnOfTask(String(active.id))
        if (!columnId) return

        const columnTasks = tasks
          .filter((t) => t.columnId === columnId)
          .sort((a, b) => a.position - b.position)
        const taskIds = columnTasks.map((t) => t.id)
        const oldIndex = taskIds.indexOf(String(active.id))
        const newIndex = taskIds.indexOf(String(over.id))

        if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
          void reorderTasks(columnId, arrayMove(taskIds, oldIndex, newIndex))
        }
      }
    },
    [columns, tasks, findColumnOfTask, reorderColumns, reorderTasks],
  )

  return { activeItem, onDragStart, onDragOver, onDragEnd }
}
