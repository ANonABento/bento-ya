import { useEffect, useCallback, useState } from 'react'
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
import { useScriptStore } from '@/stores/script-store'
import { Column } from '@/components/kanban/column'
import { DragOverlayContent } from '@/components/kanban/drag-overlay'
import { DependencyLines } from '@/components/kanban/dependency-lines'
import { DepDragPreview } from '@/components/kanban/dep-drag-preview'
import { useDepDrag } from '@/hooks/use-dep-drag'
import { TaskSidePanel } from '@/components/layout/split-view'
import { OrchestratorPanel } from '@/components/panel/orchestrator-panel'
import { useDnd } from '@/hooks/use-dnd'
import { useChatPanel } from '@/hooks/use-chat-panel'
import { useUIStore } from '@/stores/ui-store'
import { CardPositionContext, useCardPositionProvider } from '@/hooks/use-card-positions'
import { DepDragContext } from '@/hooks/use-dep-drag-context'

export function Board() {
  const panelDock = useUIStore((s) => s.panelDock)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const columns = useColumnStore((s) => s.columns)
  const loadColumns = useColumnStore((s) => s.load)
  const addColumn = useColumnStore((s) => s.add)
  const loadTasks = useTaskStore((s) => s.load)
  const tasks = useTaskStore((s) => s.tasks)
  const loadScripts = useScriptStore((s) => s.load)

  const handleAddColumn = useCallback(() => {
    if (!activeWorkspaceId) return
    const name = `Column ${String(columns.length + 1)}`
    void addColumn(activeWorkspaceId, name)
  }, [activeWorkspaceId, columns.length, addColumn])

  const { registerCard, positions } = useCardPositionProvider()
  const { dragState, handlePointerDown: onDepDragStart } = useDepDrag(tasks, positions)
  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null)

  const { isChatOpen, activeTaskId, closeChat } = useChatPanel()
  const collapseTask = useUIStore((s) => s.collapseTask)

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
    setHoveredTaskId(null)
    if (activeWorkspaceId) {
      void loadColumns(activeWorkspaceId)
      void loadTasks(activeWorkspaceId)
      void loadScripts()
    }
  }, [activeWorkspaceId, loadColumns, loadTasks, loadScripts])

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

  return (
    <CardPositionContext.Provider value={{ registerCard, positions }}>
    <DepDragContext.Provider value={{ onDepDragStart, isDraggingDep: !!dragState, hoveredTaskId, setHoveredTaskId }}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={(e) => { setHoveredTaskId(null); collapseTask(); onDragStart(e) }}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
      >
        <div className="flex h-full">
          {/* Board + orchestrator panel (left side, shrinks when task panel open) */}
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="relative flex flex-1 overflow-x-auto" data-board-scroll>
              <SortableContext items={columnIds} strategy={horizontalListSortingStrategy}>
                {sortedColumns.map((col) => (
                  <Column key={col.id} column={col} />
                ))}
              </SortableContext>

              {/* Add column button */}
              {!isChatOpen && (
                <button
                  onClick={handleAddColumn}
                  className="group flex h-full w-[280px] min-w-[200px] shrink-0 flex-col items-center justify-center gap-2 border-r border-dashed border-border-default bg-surface/10 text-text-secondary/40 transition-all hover:border-accent/50 hover:bg-accent/10 hover:text-accent"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-8 w-8">
                    <path d="M9 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4M9 3v18M9 3h6m-6 18h6m0-18h4a2 2 0 0 1 2 2v6m-6-8v10" strokeLinecap="round"/>
                    <path d="M19 15v3m0 3v-3m0 0h-3m3 0h3" strokeLinecap="round"/>
                  </svg>
                  <span className="text-xs font-medium">Add Column</span>
                </button>
              )}

              {/* Dependency lines overlay */}
              <DependencyLines tasks={tasks} positions={positions} hoveredTaskId={hoveredTaskId} />
              {dragState && <DepDragPreview dragState={dragState} positions={positions} />}
            </div>

            {/* Orchestrator panel - bottom dock */}
            {activeWorkspaceId && panelDock === 'bottom' && (
              <OrchestratorPanel workspaceId={activeWorkspaceId} />
            )}
          </div>

          {/* Orchestrator panel - right dock */}
          {activeWorkspaceId && panelDock === 'right' && (
            <OrchestratorPanel workspaceId={activeWorkspaceId} />
          )}

          {/* Task side panel (slides in from right, board stays visible) */}
          <TaskSidePanel taskId={activeTaskId} onClose={closeChat} />
        </div>
        <DragOverlay dropAnimation={null}>
          {overlayContent}
        </DragOverlay>
      </DndContext>
    </DepDragContext.Provider>
    </CardPositionContext.Provider>
  )
}
