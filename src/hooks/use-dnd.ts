/** Hook for drag-and-drop task reordering across kanban columns (dnd-kit). */

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
import type { Column, Task } from '@/types'

type ActiveItem =
  | { type: 'column'; id: string }
  | { type: 'task'; id: string }

type DragData = {
  type?: string
  columnId?: string
}

const COLUMN_DROP_PREFIX = 'column-drop-'

function stripColumnDropPrefix(id: string) {
  return id.startsWith(COLUMN_DROP_PREFIX) ? id.slice(COLUMN_DROP_PREFIX.length) : id
}

export function resolveOverColumnId(
  overId: UniqueIdentifier,
  overData: DragData | undefined,
  tasks: Pick<Task, 'id' | 'columnId'>[],
  columns: Pick<Column, 'id'>[],
) {
  if (overData?.columnId) return overData.columnId

  const id = String(overId)
  const normalizedColumnId = stripColumnDropPrefix(id)

  if (overData?.type === 'column') return normalizedColumnId
  if (columns.some((column) => column.id === normalizedColumnId)) return normalizedColumnId

  return tasks.find((task) => task.id === id)?.columnId
}

export function getTaskDropPosition(
  overId: UniqueIdentifier,
  targetColumnId: string,
  tasks: Pick<Task, 'id' | 'columnId' | 'position'>[],
) {
  const overIdString = String(overId)
  const targetTasks = tasks
    .filter((task) => task.columnId === targetColumnId)
    .sort((a, b) => a.position - b.position)

  const overIndex = targetTasks.findIndex((task) => task.id === overIdString)
  return overIndex >= 0 ? overIndex : targetTasks.length
}

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
      const overData = over.data.current as DragData | undefined

      const activeColumn = findColumnOfTask(activeTaskId)
      const overColumn = resolveOverColumnId(over.id, overData, tasks, columns)

      if (!activeColumn || !overColumn || activeColumn === overColumn) return

      const newPosition = getTaskDropPosition(over.id, overColumn, tasks)

      void moveTask(activeTaskId, overColumn, newPosition)
    },
    [columns, findColumnOfTask, tasks, moveTask],
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
        const activeTaskId = String(active.id)
        const activeColumnId = findColumnOfTask(activeTaskId)
        if (!activeColumnId) return

        const overData = over.data.current as DragData | undefined
        const overColumnId = resolveOverColumnId(over.id, overData, tasks, columns)
        if (!overColumnId) return

        if (overColumnId !== activeColumnId) {
          const newPosition = getTaskDropPosition(over.id, overColumnId, tasks)
          void moveTask(activeTaskId, overColumnId, newPosition)
          return
        }

        const columnTasks = tasks
          .filter((t) => t.columnId === activeColumnId)
          .sort((a, b) => a.position - b.position)
        const taskIds = columnTasks.map((t) => t.id)
        const oldIndex = taskIds.indexOf(activeTaskId)
        const newIndex = taskIds.indexOf(String(over.id))

        if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
          void reorderTasks(activeColumnId, arrayMove(taskIds, oldIndex, newIndex))
        }
      }
    },
    [columns, tasks, findColumnOfTask, reorderColumns, reorderTasks, moveTask],
  )

  return { activeItem, onDragStart, onDragOver, onDragEnd }
}
