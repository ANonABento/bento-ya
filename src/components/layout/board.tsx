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
import { OrchestratorPanel } from '@/components/panel/orchestrator-panel'
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
        <div className="flex flex-1 overflow-x-auto">
          <SortableContext items={columnIds} strategy={horizontalListSortingStrategy}>
            {sortedColumns.map((col) => (
              <Column key={col.id} column={col} />
            ))}
          </SortableContext>

          {/* Add column button - styled like a column */}
          <button
            onClick={handleAddColumn}
            className="group flex h-full w-[280px] min-w-[200px] shrink-0 flex-col items-center justify-center gap-2 border-r border-dashed border-border-default bg-surface/10 text-text-secondary/40 transition-all hover:border-accent/50 hover:bg-accent/10 hover:text-accent"
          >
            {/* View columns plus icon */}
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-8 w-8">
              <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4M9 3v18M9 3h6m-6 18h6m0-18h4a2 2 0 0 1 2 2v6m-6-8v10" strokeLinecap="round"/>
              <path d="M19 15v3m0 3v-3m0 0h-3m3 0h3" strokeLinecap="round"/>
            </svg>
            <span className="text-xs font-medium">Add Column</span>
          </button>
        </div>

        {/* Orchestrator panel */}
        {activeWorkspaceId && (
          <OrchestratorPanel workspaceId={activeWorkspaceId} />
        )}
      </div>
      <DragOverlay dropAnimation={null}>
        {overlayContent}
      </DragOverlay>
    </DndContext>
  )
}
