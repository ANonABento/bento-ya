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
import { useSwipeNavigation } from '@/hooks/use-swipe'
import type { Workspace } from '@/types'

// ─── Types ──────────────────────────────────────────────────────────────────

type TabProps = {
  workspace: Workspace
  isActive: boolean
  notificationCount?: number
  onSelect: () => void
  onClose: () => void
}

// ─── SortableTab ────────────────────────────────────────────────────────────

function SortableTab({
  workspace,
  isActive,
  notificationCount = 0,
  onSelect,
  onClose,
}: TabProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: workspace.id })

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
      <button
        onClick={onSelect}
        className={`
          group flex h-8 items-center gap-2 rounded-lg px-3 text-sm font-medium
          transition-colors duration-150
          ${isActive
            ? 'bg-surface-hover text-text-primary'
            : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
          }
        `}
      >
        <span className="max-w-[120px] truncate">{workspace.name}</span>

        {/* Notification badge */}
        {notificationCount > 0 && (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-attention px-1 text-[10px] font-bold text-bg">
            {notificationCount > 9 ? '9+' : notificationCount}
          </span>
        )}

        {/* Close button */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            onClose()
          }}
          className="ml-1 flex h-4 w-4 items-center justify-center rounded opacity-0 transition-opacity hover:bg-error/20 group-hover:opacity-100"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 16 16"
            fill="currentColor"
            className="h-3 w-3"
          >
            <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z" />
          </svg>
        </button>
      </button>

      {/* Active indicator */}
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

// ─── Tab overlay (shown while dragging) ─────────────────────────────────────

function TabOverlay({ workspace }: { workspace: Workspace }) {
  return (
    <div className="flex h-8 items-center gap-2 rounded-lg bg-surface-hover px-3 text-sm font-medium text-text-primary shadow-lg">
      <span className="max-w-[120px] truncate">{workspace.name}</span>
    </div>
  )
}

// ─── AddTabButton ───────────────────────────────────────────────────────────

function AddTabButton({ onClick }: { onClick: () => void }) {
  return (
    <motion.button
      onClick={onClick}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 16 16"
        fill="currentColor"
        className="h-4 w-4"
      >
        <path d="M8.75 3.75a.75.75 0 0 0-1.5 0v3.5h-3.5a.75.75 0 0 0 0 1.5h3.5v3.5a.75.75 0 0 0 1.5 0v-3.5h3.5a.75.75 0 0 0 0-1.5h-3.5v-3.5Z" />
      </svg>
    </motion.button>
  )
}

// ─── SettingsButton ─────────────────────────────────────────────────────────

function SettingsButton() {
  const openSettings = useSettingsStore((s) => s.openSettings)

  return (
    <motion.button
      onClick={openSettings}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      className="flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
      title="Settings"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className="h-4 w-4"
      >
        <path fillRule="evenodd" d="M8.34 1.804A1 1 0 0 1 9.32 1h1.36a1 1 0 0 1 .98.804l.295 1.473c.497.144.971.342 1.416.587l1.25-.834a1 1 0 0 1 1.262.125l.962.962a1 1 0 0 1 .125 1.262l-.834 1.25c.245.445.443.919.587 1.416l1.473.295a1 1 0 0 1 .804.98v1.36a1 1 0 0 1-.804.98l-1.473.295a6.95 6.95 0 0 1-.587 1.416l.834 1.25a1 1 0 0 1-.125 1.262l-.962.962a1 1 0 0 1-1.262.125l-1.25-.834a6.953 6.953 0 0 1-1.416.587l-.295 1.473a1 1 0 0 1-.98.804H9.32a1 1 0 0 1-.98-.804l-.295-1.473a6.957 6.957 0 0 1-1.416-.587l-1.25.834a1 1 0 0 1-1.262-.125l-.962-.962a1 1 0 0 1-.125-1.262l.834-1.25a6.957 6.957 0 0 1-.587-1.416l-1.473-.295A1 1 0 0 1 1 10.68V9.32a1 1 0 0 1 .804-.98l1.473-.295c.144-.497.342-.971.587-1.416l-.834-1.25a1 1 0 0 1 .125-1.262l.962-.962A1 1 0 0 1 5.38 3.03l1.25.834a6.957 6.957 0 0 1 1.416-.587l.295-1.473ZM13 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" clipRule="evenodd" />
      </svg>
    </motion.button>
  )
}

// ─── ChecklistButton ─────────────────────────────────────────────────────────

function ChecklistButton() {
  const openChecklist = useChecklistStore((s) => s.openChecklist)
  const getProgress = useChecklistStore((s) => s.getProgress)

  const { progress, total } = getProgress()
  const hasItems = total > 0
  const allComplete = hasItems && progress === total

  return (
    <motion.button
      onClick={openChecklist}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      className="relative flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
      title="Production Checklist"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 20 20"
        fill="currentColor"
        className={`h-4 w-4 ${allComplete ? 'text-success' : ''}`}
      >
        <path fillRule="evenodd" d="M6 4.75A.75.75 0 0 1 6.75 4h10.5a.75.75 0 0 1 0 1.5H6.75A.75.75 0 0 1 6 4.75ZM6 10a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H6.75A.75.75 0 0 1 6 10Zm0 5.25a.75.75 0 0 1 .75-.75h10.5a.75.75 0 0 1 0 1.5H6.75a.75.75 0 0 1-.75-.75ZM1.99 4.75a1 1 0 0 1 1-1H3a1 1 0 0 1 1 1v.01a1 1 0 0 1-1 1h-.01a1 1 0 0 1-1-1v-.01ZM1.99 15.25a1 1 0 0 1 1-1H3a1 1 0 0 1 1 1v.01a1 1 0 0 1-1 1h-.01a1 1 0 0 1-1-1v-.01ZM1.99 10a1 1 0 0 1 1-1H3a1 1 0 0 1 1 1v.01a1 1 0 0 1-1 1h-.01a1 1 0 0 1-1-1V10Z" clipRule="evenodd" />
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
  )
}

// ─── TabBar ─────────────────────────────────────────────────────────────────

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

  // ─── Tab Navigation ─────────────────────────────────────────────────────────

  const selectByIndex = useCallback(
    (index: number) => {
      const workspace = sortedWorkspaces[index]
      if (workspace) {
        setActive(workspace.id)
      }
    },
    [sortedWorkspaces, setActive],
  )

  const selectPrev = useCallback(() => {
    const currentIndex = sortedWorkspaces.findIndex((w) => w.id === activeWorkspaceId)
    const newIndex = currentIndex > 0 ? currentIndex - 1 : sortedWorkspaces.length - 1
    selectByIndex(newIndex)
  }, [sortedWorkspaces, activeWorkspaceId, selectByIndex])

  const selectNext = useCallback(() => {
    const currentIndex = sortedWorkspaces.findIndex((w) => w.id === activeWorkspaceId)
    const newIndex = currentIndex < sortedWorkspaces.length - 1 ? currentIndex + 1 : 0
    selectByIndex(newIndex)
  }, [sortedWorkspaces, activeWorkspaceId, selectByIndex])

  const closeCurrentTab = useCallback(() => {
    if (activeWorkspaceId && sortedWorkspaces.length > 1) {
      remove(activeWorkspaceId)
    }
  }, [activeWorkspaceId, sortedWorkspaces.length, remove])

  // ─── Swipe Navigation ───────────────────────────────────────────────────────

  useSwipeNavigation(selectPrev, selectNext, sortedWorkspaces.length > 1)

  // ─── Keyboard Shortcuts ─────────────────────────────────────────────────────

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMod = e.metaKey || e.ctrlKey

      if (isMod && !e.shiftKey) {
        // Cmd+1-9: Switch to tab by index
        if (e.key >= '1' && e.key <= '9') {
          e.preventDefault()
          const index = parseInt(e.key, 10) - 1
          selectByIndex(index)
          return
        }

        // Cmd+T: New tab
        if (e.key === 't') {
          e.preventDefault()
          setShowAddDialog(true)
          return
        }

        // Cmd+W: Close current tab
        if (e.key === 'w') {
          e.preventDefault()
          closeCurrentTab()
          return
        }
      }

      // Ctrl+Tab / Ctrl+Shift+Tab: Next/Prev tab
      if (e.ctrlKey && e.key === 'Tab') {
        e.preventDefault()
        if (e.shiftKey) {
          selectPrev()
        } else {
          selectNext()
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [selectByIndex, selectPrev, selectNext, closeCurrentTab])

  // ─── Drag Handlers ──────────────────────────────────────────────────────────

  const handleDragStart = (e: DragStartEvent) => {
    setDraggingId(e.active.id as string)
  }

  const handleDragEnd = (e: DragEndEvent) => {
    setDraggingId(null)

    const { active, over } = e
    if (!over || active.id === over.id) return

    const oldIndex = workspaceIds.indexOf(active.id as string)
    const newIndex = workspaceIds.indexOf(over.id as string)
    const newOrder = arrayMove(workspaceIds, oldIndex, newIndex)
    reorder(newOrder)
  }

  const draggingWorkspace = draggingId
    ? sortedWorkspaces.find((w) => w.id === draggingId)
    : null

  // Only show tabs if there are workspaces
  if (sortedWorkspaces.length === 0) {
    return (
      <header className="flex h-10 shrink-0 items-center justify-center border-b border-border-default bg-surface">
        <span className="text-sm font-medium text-text-secondary">Bento-ya</span>
      </header>
    )
  }

  return (
    <>
      <header className="flex h-10 shrink-0 items-center justify-between border-b border-border-default bg-surface px-2">
        {/* Left spacer */}
        <div className="w-8" />

        {/* Center: tabs */}
        <div className="flex items-center gap-1">
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
                    notificationCount={getUnviewedCount(workspace.id)}
                    onSelect={() => setActive(workspace.id)}
                    onClose={() => {
                      if (sortedWorkspaces.length > 1) {
                        remove(workspace.id)
                      }
                    }}
                  />
                ))}
              </AnimatePresence>
            </SortableContext>

            <DragOverlay>
              {draggingWorkspace && <TabOverlay workspace={draggingWorkspace} />}
            </DragOverlay>
          </DndContext>

          <AddTabButton onClick={() => setShowAddDialog(true)} />
        </div>

        {/* Right: checklist + settings */}
        <div className="flex items-center gap-1">
          <ChecklistButton />
          <SettingsButton />
        </div>
      </header>

      {/* Add workspace dialog - simple placeholder for now */}
      {showAddDialog && (
        <AddWorkspaceDialog onClose={() => setShowAddDialog(false)} />
      )}
    </>
  )
}

// ─── AddWorkspaceDialog ─────────────────────────────────────────────────────

function AddWorkspaceDialog({ onClose }: { onClose: () => void }) {
  const add = useWorkspaceStore((s) => s.add)
  const [name, setName] = useState('')
  const [repoPath, setRepoPath] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || !repoPath.trim() || isSubmitting) return

    setIsSubmitting(true)
    try {
      await add(name.trim(), repoPath.trim())
      onClose()
    } catch (err) {
      console.error('Failed to add workspace:', err)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-xl border border-border-default bg-surface p-6 shadow-xl"
      >
        <h2 className="mb-4 text-lg font-semibold text-text-primary">Add Workspace</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm text-text-secondary">Name</label>
            <input
              ref={inputRef}
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Project"
              className="w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm text-text-secondary">Repository Path</label>
            <input
              type="text"
              value={repoPath}
              onChange={(e) => setRepoPath(e.target.value)}
              placeholder="/path/to/repo"
              className="w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm text-text-secondary hover:bg-surface-hover"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || !repoPath.trim() || isSubmitting}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg disabled:opacity-50"
            >
              {isSubmitting ? 'Adding...' : 'Add'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  )
}
