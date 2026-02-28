import { useEffect, useCallback } from 'react'
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import { SortableContext, horizontalListSortingStrategy, sortableKeyboardCoordinates } from '@dnd-kit/sortable'
import { useColumnStore } from '@/stores/column-store'
import { useTaskStore } from '@/stores/task-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { Column } from '@/components/kanban/column'
import { DragOverlayContent } from '@/components/kanban/drag-overlay'
import { SplitViewWrapper } from '@/components/layout/split-view'
import { ChatInput } from '@/components/chat/chat-input'
import { useDnd } from '@/hooks/use-dnd'
import { useSplitView } from '@/hooks/use-split-view'

export function Board() {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const columns = useColumnStore((s) => s.columns)
  const loadColumns = useColumnStore((s) => s.load)
  const addColumn = useColumnStore((s) => s.add)
  const loadTasks = useTaskStore((s) => s.load)
  const tasks = useTaskStore((s) => s.tasks)

  const handleAddColumn = useCallback(() => {
    if (!activeWorkspaceId) return
    const name = `Column ${String(columns.length + 1)}`
    void addColumn(activeWorkspaceId, name)
  }, [activeWorkspaceId, columns.length, addColumn])

  const { isSplitView, activeTaskId, closeSplitView } = useSplitView()

  const sortedColumns = columns
    .filter((c) => c.visible)
    .sort((a, b) => a.position - b.position)
  const columnIds = sortedColumns.map((c) => c.id)

  const { activeItem, onDragStart, onDragOver, onDragEnd } = useDnd()

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  )

  useEffect(() => {
    if (activeWorkspaceId) {
      void loadColumns(activeWorkspaceId)
      void loadTasks(activeWorkspaceId)
    }
  }, [activeWorkspaceId, loadColumns, loadTasks])

  // Resolve overlay content
  let overlayContent = null
  if (activeItem) {
    if (activeItem.type === 'column') {
      const col = columns.find((c) => c.id === activeItem.id)
      if (col) overlayContent = <DragOverlayContent item={{ type: 'column', data: col }} />
    } else {
      const task = tasks.find((t) => t.id === activeItem.id)
      if (task) overlayContent = <DragOverlayContent item={{ type: 'task', data: task }} />
    }
  }

  if (isSplitView) {
    return (
      <SplitViewWrapper
        isSplitView={isSplitView}
        taskId={activeTaskId}
        onClose={closeSplitView}
      />
    )
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragEnd={onDragEnd}
    >
      <div className="flex h-full flex-col">
        <div className="flex flex-1 items-start gap-4 overflow-x-auto p-4">
          <SortableContext items={columnIds} strategy={horizontalListSortingStrategy}>
            {sortedColumns.map((col) => (
              <Column key={col.id} column={col} />
            ))}
          </SortableContext>

          {/* Add column button */}
          <button
            onClick={handleAddColumn}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-dashed border-border-default text-text-secondary/50 transition-colors hover:border-text-secondary hover:text-text-secondary"
            title="Add column"
          >
            +
          </button>
        </div>

        {/* Orchestrator chat input */}
        {activeWorkspaceId && (
          <div className="shrink-0 border-t border-border-default bg-bg p-4">
            <ChatInput workspaceId={activeWorkspaceId} />
          </div>
        )}
      </div>
      <DragOverlay dropAnimation={null}>
        {overlayContent}
      </DragOverlay>
    </DndContext>
  )
}
