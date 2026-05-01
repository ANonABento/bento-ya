/** Hook for drag-and-drop task reordering across kanban columns (dnd-kit). */

import { useState, useCallback, useMemo } from 'react'
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

export function useDnd(showArchived = false) {
  const [activeItem, setActiveItem] = useState<ActiveItem | null>(null)
  const columns = useColumnStore((s) => s.columns)
  const reorderColumns = useColumnStore((s) => s.reorder)
  const tasks = useTaskStore((s) => s.tasks)
  const moveTask = useTaskStore((s) => s.move)
  const reorderTasks = useTaskStore((s) => s.reorder)

  const visibleTasks = useMemo(
    () => showArchived ? tasks : tasks.filter((t) => !t.archivedAt),
    [showArchived, tasks],
  )

  const findColumnOfTask = useCallback(
    (taskId: UniqueIdentifier): string | undefined => {
      return visibleTasks.find((t) => t.id === taskId)?.columnId
    },
    [visibleTasks],
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
      const overData = over.data.current as { type: string; columnId?: string } | undefined

      const activeColumn = findColumnOfTask(activeTaskId)

      // Handle dropping on column droppable area (empty columns)
      let overColumn: string | undefined
      if (overData?.type === 'column' && overData.columnId) {
        overColumn = overData.columnId
      } else if (overData?.type === 'column') {
        overColumn = overId
      } else {
        overColumn = findColumnOfTask(overId)
      }

      if (!activeColumn || !overColumn || activeColumn === overColumn) return

      // Moving task to a different column
      const overColumnTasks = visibleTasks
        .filter((t) => t.columnId === overColumn)
        .sort((a, b) => a.position - b.position)

      const overIndex = overColumnTasks.findIndex((t) => t.id === overId)
      const newPosition = overIndex >= 0 ? overIndex : overColumnTasks.length

      void moveTask(activeTaskId, overColumn, newPosition)
    },
    [findColumnOfTask, visibleTasks, moveTask],
  )

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveItem(null)
      const { active, over } = event
      if (!over || active.id === over.id) return

      const activeData = active.data.current as { type: string } | undefined

      if (activeData?.type === 'column') {
        // Reorder columns (only visible — matches SortableContext in board.tsx)
        const columnIds = columns
          .filter((c) => c.visible)
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

        const columnTasks = visibleTasks
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
    [columns, visibleTasks, findColumnOfTask, reorderColumns, reorderTasks],
  )

  return { activeItem, onDragStart, onDragOver, onDragEnd }
}
