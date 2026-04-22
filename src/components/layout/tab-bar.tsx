import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useAttentionStore } from '@/stores/attention-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useChecklistStore } from '@/stores/checklist-store'
import { Tooltip } from '@/components/shared/tooltip'
import { useSwipeNavigation } from '@/hooks/use-swipe'
import type { Workspace } from '@/types'

type TabProps = {
  workspace: Workspace
  isActive: boolean
  activeTaskCount?: number
  notificationCount?: number
  onSelect: () => void
}

function SortableTab({
  workspace,
  isActive,
  activeTaskCount = 0,
  notificationCount = 0,
  onSelect,
}: TabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: workspace.id,
  })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <motion.div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 'auto', opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ duration: 0.2, ease: 'easeOut' }}
      className="relative"
    >
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            onSelect()
          }
        }}
        style={{ cursor: 'pointer' }}
        className={`
          group flex h-8 items-center justify-center px-3 text-sm
          transition-colors duration-150
          ${
            isActive
              ? 'font-medium text-text-primary'
              : 'font-normal text-text-secondary hover:text-text-primary'
          }
        `}
      >
        <span className="flex items-center">
          <span className="max-w-[120px] truncate text-center">{workspace.name}</span>
          {activeTaskCount > 0 && (
            <span className="ml-1 rounded-full bg-primary/20 px-1.5 text-xs text-primary">
              {activeTaskCount}
            </span>
          )}
        </span>

        {notificationCount > 0 && (
          <span className="ml-2 flex h-4 min-w-4 items-center justify-center rounded-full bg-attention px-1 text-[10px] font-bold text-bg">
            {notificationCount > 9 ? '9+' : notificationCount}
          </span>
        )}
      </div>

      {isActive && (
        <motion.div
          layoutId="tab-indicator"
          className="absolute -bottom-0.5 left-2 right-2 h-0.5 rounded-full bg-accent"
          transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        />
      )}
    </motion.div>
  )
}

function TabOverlay({ workspace }: { workspace: Workspace }) {
  return (
    <div className="flex h-8 items-center gap-2 rounded-lg bg-surface-hover px-3 text-sm font-medium text-text-primary shadow-lg">
      <span className="max-w-[120px] truncate">{workspace.name}</span>
    </div>
  )
}

function AddTabButton({ onClick }: { onClick: () => void }) {
  return (
    <Tooltip content="New Workspace" side="bottom">
      <motion.button
        onClick={onClick}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-4 w-4"
        >
          <path
            fillRule="evenodd"
            d="M3.75 3A1.75 1.75 0 0 0 2 4.75v10.5c0 .966.784 1.75 1.75 1.75h12.5A1.75 1.75 0 0 0 18 15.25v-8.5A1.75 1.75 0 0 0 16.25 5h-4.836a.25.25 0 0 1-.177-.073L9.823 3.513A1.75 1.75 0 0 0 8.586 3H3.75ZM10 8a.75.75 0 0 1 .75.75v1.5h1.5a.75.75 0 0 1 0 1.5h-1.5v1.5a.75.75 0 0 1-1.5 0v-1.5h-1.5a.75.75 0 0 1 0-1.5h1.5v-1.5A.75.75 0 0 1 10 8Z"
            clipRule="evenodd"
          />
        </svg>
      </motion.button>
    </Tooltip>
  )
}

function SettingsButton() {
  const openSettings = useSettingsStore((s) => s.openSettings)

  return (
    <Tooltip content="Settings" side="bottom">
      <motion.button
        onClick={openSettings}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className="h-4 w-4"
        >
          <path
            fillRule="evenodd"
            d="M8.34 1.804A1 1 0 0 1 9.32 1h1.36a1 1 0 0 1 .98.804l.295 1.473c.497.144.971.342 1.416.587l1.25-.834a1 1 0 0 1 1.262.125l.962.962a1 1 0 0 1 .125 1.262l-.834 1.25c.245.445.443.919.587 1.416l1.473.295a1 1 0 0 1 .804.98v1.36a1 1 0 0 1-.804.98l-1.473.295a6.95 6.95 0 0 1-.587 1.416l.834 1.25a1 1 0 0 1-.125 1.262l-.962.962a1 1 0 0 1-1.262.125l-1.25-.834a6.953 6.953 0 0 1-1.416.587l-.295 1.473a1 1 0 0 1-.98.804H9.32a1 1 0 0 1-.98-.804l-.295-1.473a6.957 6.957 0 0 1-1.416-.587l-1.25.834a1 1 0 0 1-1.262-.125l-.962-.962a1 1 0 0 1-.125-1.262l.834-1.25a6.957 6.957 0 0 1-.587-1.416l-1.473-.295A1 1 0 0 1 1 10.68V9.32a1 1 0 0 1 .804-.98l1.473-.295c.144-.497.342-.971.587-1.416l-.834-1.25a1 1 0 0 1 .125-1.262l.962-.962A1 1 0 0 1 5.38 3.03l1.25.834a6.957 6.957 0 0 1 1.416-.587l.295-1.473ZM13 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
            clipRule="evenodd"
          />
        </svg>
      </motion.button>
    </Tooltip>
  )
}

function ChecklistButton() {
  const openChecklist = useChecklistStore((s) => s.openChecklist)
  const getProgress = useChecklistStore((s) => s.getProgress)

  const { progress, total } = getProgress()
  const hasItems = total > 0
  const allComplete = hasItems && progress === total

  return (
    <Tooltip content="Checklist" side="bottom">
      <motion.button
        onClick={openChecklist}
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.95 }}
        className="relative flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className={`h-4 w-4 ${allComplete ? 'text-success' : ''}`}
        >
          <path
            fillRule="evenodd"
            d="M6 4.75A.75.75 0 0 1 6.75 4h10.5a.75.75 0 0 1 0 1.5H6.75A.75.75 0 0 1 6 4.75ZM6 10a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H6.75A.75.75 0 0 1 6 10Zm0 5.25a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H6.75a.75.75 0 0 1-.75-.75ZM1.99 4.75a1 1 0 0 1 1-1H3a1 1 0 0 1 1 1v.01a1 1 0 0 1-1 1h-.01a1 1 0 0 1-1-1v-.01ZM1.99 15.25a1 1 0 0 1 1-1H3a1 1 0 0 1 1 1v.01a1 1 0 0 1-1 1h-.01a1 1 0 0 1-1-1v-.01ZM1.99 10a1 1 0 0 1 1-1H3a1 1 0 0 1 1 1v.01a1 1 0 0 1-1 1h-.01a1 1 0 0 1-1-1V10Z"
            clipRule="evenodd"
          />
        </svg>
        {hasItems && !allComplete && (
          <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-accent text-[8px] font-bold text-bg">
            {total - progress}
          </span>
        )}
        {allComplete && (
          <span className="absolute -right-0.5 -top-0.5 flex h-3 w-3 items-center justify-center rounded-full bg-success text-[8px] text-white">
            ✓
          </span>
        )}
      </motion.button>
    </Tooltip>
  )
}

export function TabBar() {
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const setActive = useWorkspaceStore((s) => s.setActive)
  const reorder = useWorkspaceStore((s) => s.reorder)
  const remove = useWorkspaceStore((s) => s.remove)
  const getUnviewedCount = useAttentionStore((s) => s.getUnviewedCount)

  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [showAddDialog, setShowAddDialog] = useState(false)

  const sortedWorkspaces = [...workspaces].sort((a, b) => a.tabOrder - b.tabOrder)
  const workspaceIds = sortedWorkspaces.map((w) => w.id)

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  )

  useTabBarNavigation({
    sortedWorkspaces,
    activeWorkspaceId,
    setActive,
    remove,
    openAddDialog: () => { setShowAddDialog(true) },
  })

  const handleDragStart = (event: DragStartEvent) => {
    setDraggingId(String(event.active.id))
  }

  const handleDragEnd = (event: DragEndEvent) => {
    setDraggingId(null)

    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = workspaceIds.indexOf(String(active.id))
    const newIndex = workspaceIds.indexOf(String(over.id))
    if (oldIndex < 0 || newIndex < 0) return

    const newOrder = arrayMove(workspaceIds, oldIndex, newIndex)
    void reorder(newOrder)
  }

  const draggingWorkspace = draggingId
    ? sortedWorkspaces.find((workspace) => workspace.id === draggingId) ?? null
    : null

  if (sortedWorkspaces.length === 0) {
    return (
      <header className="flex h-10 shrink-0 items-center justify-center border-b border-border-default bg-surface">
        <span className="text-sm font-medium text-text-secondary">Bento-ya</span>
      </header>
    )
  }

  return (
    <>
      <header className="relative flex h-10 shrink-0 items-center bg-surface px-2 shadow-sm">
        <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-1">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext items={workspaceIds} strategy={horizontalListSortingStrategy}>
              <AnimatePresence mode="popLayout">
                {sortedWorkspaces.map((workspace) => (
                  <SortableTab
                    key={workspace.id}
                    workspace={workspace}
                    isActive={workspace.id === activeWorkspaceId}
                    activeTaskCount={workspace.activeTaskCount}
                    notificationCount={getUnviewedCount(workspace.id)}
                    onSelect={() => { setActive(workspace.id) }}
                  />
                ))}
              </AnimatePresence>
            </SortableContext>

            <DragOverlay>
              {draggingWorkspace && <TabOverlay workspace={draggingWorkspace} />}
            </DragOverlay>
          </DndContext>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <AddTabButton onClick={() => { setShowAddDialog(true) }} />
          <ChecklistButton />
          <SettingsButton />
        </div>
      </header>

      {showAddDialog && (
        <AddWorkspaceDialog onClose={() => { setShowAddDialog(false) }} />
      )}
    </>
  )
}
