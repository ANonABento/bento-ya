import { useEffect, useCallback, useState, useMemo } from 'react'
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
import { useSettingsStore } from '@/stores/settings-store'
import { useWorkspaceUsageByModel } from '@/hooks/use-workspace-usage-by-model'
import { ModelUsageWarningBanner } from '@/components/usage/model-usage-warning-banner'

const USAGE_WARNING_DISMISSED_STORAGE_KEY = 'token-usage-warning-dismissed-v1'

export function Board() {
  const panelDock = useUIStore((s) => s.panelDock)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const columns = useColumnStore((s) => s.columns)
  const loadColumns = useColumnStore((s) => s.load)
  const addColumn = useColumnStore((s) => s.add)
  const loadTasks = useTaskStore((s) => s.load)
  const tasks = useTaskStore((s) => s.tasks)
  const loadScripts = useScriptStore((s) => s.load)

  const [newColumnId, setNewColumnId] = useState<string | null>(null)

  const handleAddColumn = useCallback(() => {
    if (!activeWorkspaceId) return
    const name = `Column ${String(columns.length + 1)}`
    void addColumn(activeWorkspaceId, name).then((col) => {
      setNewColumnId(col.id)
    })
  }, [activeWorkspaceId, columns.length, addColumn])

  const { registerCard, positions } = useCardPositionProvider()
  const { dragState, handlePointerDown: onDepDragStart } = useDepDrag(tasks, positions)
  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null)

  const { isChatOpen, activeTaskId, closeChat } = useChatPanel()
  const collapseTask = useUIStore((s) => s.collapseTask)
  const model = useSettingsStore((s) => s.global.model)
  const budgets = model.dailyTokenBudgets
  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const usageByModel = useWorkspaceUsageByModel(activeWorkspaceId ?? '', {
    enabled: !!activeWorkspaceId,
    date: today,
  })
  const [dismissedWarnings, setDismissedWarnings] = useState<Set<string>>(new Set())
  const [loadedDismissalStorageKey, setLoadedDismissalStorageKey] = useState<string | null>(null)

  const storageKey = useMemo(() => {
    if (!activeWorkspaceId) return ''
    return `${activeWorkspaceId}|${today}`
  }, [activeWorkspaceId, today])

  useEffect(() => {
    if (!activeWorkspaceId) {
      setDismissedWarnings(new Set())
      setLoadedDismissalStorageKey(null)
      return
    }

    try {
      const raw = localStorage.getItem(USAGE_WARNING_DISMISSED_STORAGE_KEY)
      if (!raw) {
        setDismissedWarnings(new Set())
        setLoadedDismissalStorageKey(storageKey)
        return
      }

      const parsed = JSON.parse(raw)
      const saved = parsed?.[storageKey]
      if (!Array.isArray(saved)) {
        setDismissedWarnings(new Set())
        setLoadedDismissalStorageKey(storageKey)
        return
      }

      const values = new Set<string>()
      for (const modelId of saved) {
        if (typeof modelId === 'string') {
          values.add(`${storageKey}|${modelId}`)
        }
      }
      setDismissedWarnings(values)
      setLoadedDismissalStorageKey(storageKey)
    } catch {
      setDismissedWarnings(new Set())
      setLoadedDismissalStorageKey(storageKey)
    }
  }, [activeWorkspaceId, storageKey])

  // Unified close: collapse card + close chat (used by back button, Escape, re-click)
  const handleCloseAll = useCallback(() => {
    closeChat()
    collapseTask()
  }, [closeChat, collapseTask])

  const sortedColumns = columns
    .filter((c) => c.visible)
    .sort((a, b) => a.position - b.position)
  const columnIds = sortedColumns.map((c) => c.id)
  const warningSummaries = useMemo(() => {
    return usageByModel.summaries
      .filter((record) => {
        const budget = budgets[record.model] ?? 0
        if (!Number.isFinite(budget) || budget <= 0) return false
        const used = record.totalInputTokens + record.totalOutputTokens
        return (used / budget) >= 0.8
      })
      .map((record) => record.model)
      .filter((modelId) => !dismissedWarnings.has(`${storageKey}|${modelId}`))
  }, [budgets, dismissedWarnings, storageKey, usageByModel.summaries])

  const dismissedModelIds = useMemo(() => {
    const result = new Set<string>()
    for (const value of dismissedWarnings) {
      const separatorIndex = value.lastIndexOf('|')
      if (separatorIndex === -1) continue
      const key = value.slice(0, separatorIndex)
      if (key !== storageKey) continue
      result.add(value.slice(separatorIndex + 1))
    }
    return result
  }, [dismissedWarnings, storageKey])

  useEffect(() => {
    if (!activeWorkspaceId || loadedDismissalStorageKey !== storageKey) return
    let rawPayload: Record<string, string[]> = {}

    try {
      const existingRaw = localStorage.getItem(USAGE_WARNING_DISMISSED_STORAGE_KEY)
      if (existingRaw) {
        const existing = JSON.parse(existingRaw)
        if (existing && typeof existing === 'object' && !Array.isArray(existing)) {
          rawPayload = existing as Record<string, string[]>
        }
      }
    } catch {
      rawPayload = {}
    }

    const nextModelIds: string[] = []
    dismissedWarnings.forEach((value) => {
      const separatorIndex = value.lastIndexOf('|')
      if (separatorIndex === -1) return
      const key = value.slice(0, separatorIndex)
      const modelId = value.slice(separatorIndex + 1)
      if (!modelId) return
      if (key === storageKey) {
        nextModelIds.push(modelId)
        return
      }
      rawPayload[key] = Array.from(new Set([...(rawPayload[key] ?? []), modelId]))
    })
    rawPayload[storageKey] = Array.from(new Set(nextModelIds))

    localStorage.setItem(USAGE_WARNING_DISMISSED_STORAGE_KEY, JSON.stringify(rawPayload))
  }, [activeWorkspaceId, dismissedWarnings, loadedDismissalStorageKey, storageKey])

  const handleDismissWarnings = () => {
    if (!activeWorkspaceId || warningSummaries.length === 0) return

    const next = new Set(dismissedWarnings)
    for (const modelId of warningSummaries) {
      next.add(`${storageKey}|${modelId}`)
    }
    setDismissedWarnings(next)
  }

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
        <div className="flex h-full flex-col" data-board-container>
          {warningSummaries.length > 0 && (
            <ModelUsageWarningBanner
              usage={usageByModel.summaries}
              modelBudgets={budgets}
              onDismiss={handleDismissWarnings}
              dismissed={dismissedModelIds}
            />
          )}

          {/* Board + orchestrator panel (left side, shrinks when task panel open) */}
          <div className="flex flex-1 flex-col overflow-hidden">
            <div className="relative flex flex-1 overflow-x-auto" data-board-scroll>
              <SortableContext items={columnIds} strategy={horizontalListSortingStrategy}>
                {sortedColumns.map((col) => (
                  <Column
                    key={col.id}
                    column={col}
                    autoOpenConfig={col.id === newColumnId}
                    onConfigOpened={col.id === newColumnId ? () => { setNewColumnId(null) } : undefined}
                  />
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
          <TaskSidePanel taskId={activeTaskId} onClose={handleCloseAll} />
        </div>
        <DragOverlay dropAnimation={null}>
          {overlayContent}
        </DragOverlay>
      </DndContext>
    </DepDragContext.Provider>
    </CardPositionContext.Provider>
  )
}
