import { memo, useState, useCallback, useMemo, useRef, useEffect } from 'react'
import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useDroppable } from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { motion, AnimatePresence } from 'motion/react'
import type { Column as ColumnType, RunScriptAction } from '@/types'
import { getColumnTriggers } from '@/types/column'
import { useTaskStore } from '@/stores/task-store'
import { useColumnStore } from '@/stores/column-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useScriptStore } from '@/stores/script-store'
import { ColumnHeader } from './column-header'
import { TaskCard } from './task-card'
import { ColumnConfigDialog } from './column-config-dialog'

type ColumnProps = {
  column: ColumnType
}

export const Column = memo(function Column({ column }: ColumnProps) {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const allTasks = useTaskStore((s) => s.tasks)
  const addTask = useTaskStore((s) => s.add)
  const remove = useColumnStore((s) => s.remove)
  const getScriptName = useScriptStore((s) => s.getScriptName)

  // Memoize filtered tasks to prevent infinite loops
  const tasks = useMemo(
    () => allTasks
      .filter((t) => t.columnId === column.id)
      .sort((a, b) => a.position - b.position),
    [allTasks, column.id]
  )
  const taskIds = useMemo(() => tasks.map((t) => t.id), [tasks])

  const scriptTrigger = useMemo(() => {
    const triggers = getColumnTriggers(column)
    const entryIsScript = triggers.on_entry?.type === 'run_script'
    const exitIsScript = triggers.on_exit?.type === 'run_script'
    if (!entryIsScript && !exitIsScript) return undefined

    const scriptId = entryIsScript
      ? (triggers.on_entry as RunScriptAction).script_id
      : (triggers.on_exit as RunScriptAction).script_id
    const scriptName = getScriptName(scriptId)
    if (!scriptName) return undefined

    const event = entryIsScript && exitIsScript ? 'both' as const
      : entryIsScript ? 'entry' as const : 'exit' as const
    return { scriptName, event }
  }, [column, getScriptName])

  const [showConfigDialog, setShowConfigDialog] = useState(false)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [showAddTask, setShowAddTask] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const addTaskInputRef = useRef<HTMLInputElement>(null)

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

  // Make empty column area droppable
  const { setNodeRef: setDroppableRef, isOver } = useDroppable({
    id: `column-drop-${column.id}`,
    data: { type: 'column', columnId: column.id },
  })

  // Focus input when add task is shown
  useEffect(() => {
    if (showAddTask) {
      addTaskInputRef.current?.focus()
    }
  }, [showAddTask])

  const handleConfigure = useCallback(() => {
    setShowConfigDialog(true)
  }, [])

  const handleDelete = useCallback(() => {
    if (tasks.length > 0) {
      setShowDeleteConfirm(true)
    } else {
      void remove(column.id)
    }
  }, [column.id, tasks.length, remove])

  const confirmDelete = useCallback(() => {
    void remove(column.id)
    setShowDeleteConfirm(false)
  }, [column.id, remove])

  const handleAddTask = useCallback(() => {
    setShowAddTask(true)
  }, [])

  const handleSubmitTask = useCallback(async () => {
    if (!newTaskTitle.trim() || !activeWorkspaceId) return
    await addTask(activeWorkspaceId, column.id, newTaskTitle.trim(), '')
    setNewTaskTitle('')
    setShowAddTask(false)
  }, [newTaskTitle, activeWorkspaceId, column.id, addTask])

  const handleCancelAddTask = useCallback(() => {
    setNewTaskTitle('')
    setShowAddTask(false)
  }, [])

  return (
    <>
      <motion.div
        ref={setNodeRef}
        style={style}
        layout
        data-column-id={column.id}
        className={`flex w-[300px] min-w-[280px] max-w-[360px] shrink-0 flex-col border-r border-border-default bg-surface/30 ${
          isDragging ? 'opacity-50' : ''
        }`}
      >
        <div {...attributes} {...listeners} className="cursor-grab active:cursor-grabbing">
          <ColumnHeader
            name={column.name}
            icon={column.icon || 'list'}
            taskCount={tasks.length}
            color={column.color}
            scriptTrigger={scriptTrigger}
            onConfigure={handleConfigure}
            onDelete={handleDelete}
            onAddTask={handleAddTask}
          />
        </div>

        <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
          <div
            ref={setDroppableRef}
            className={`flex flex-1 flex-col gap-2 overflow-y-auto px-2 pt-1 pb-2 transition-colors ${
              isOver ? 'bg-accent/5' : ''
            }`}
          >
            {/* Inline add task input */}
            <AnimatePresence>
              {showAddTask && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="rounded-lg border border-accent bg-surface p-2">
                    <input
                      ref={addTaskInputRef}
                      type="text"
                      value={newTaskTitle}
                      onChange={(e) => { setNewTaskTitle(e.target.value); }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void handleSubmitTask()
                        if (e.key === 'Escape') handleCancelAddTask()
                      }}
                      placeholder="Task title..."
                      className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-secondary/50 focus:outline-none"
                    />
                    <div className="mt-2 flex justify-end gap-1">
                      <button
                        onClick={handleCancelAddTask}
                        className="rounded px-2 py-1 text-xs text-text-secondary hover:bg-surface-hover"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => void handleSubmitTask()}
                        disabled={!newTaskTitle.trim()}
                        className="rounded bg-accent px-2 py-1 text-xs font-medium text-bg disabled:opacity-50"
                      >
                        Add
                      </button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {tasks.length === 0 && !showAddTask ? (
              <div className="flex flex-1 items-center justify-center min-h-[100px]">
                <p className={`text-xs transition-colors ${isOver ? 'text-accent' : 'text-text-secondary/50'}`}>
                  {isOver ? 'Drop here' : 'No tasks yet'}
                </p>
              </div>
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
          onClose={() => { setShowConfigDialog(false); }}
        />
      )}

      {/* Delete confirmation dialog */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => { setShowDeleteConfirm(false); }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={(e) => { e.stopPropagation(); }}
            className="w-full max-w-sm rounded border border-border-default bg-surface p-6 shadow-xl"
          >
            <h3 className="mb-2 text-lg font-semibold text-text-primary">
              Delete Column?
            </h3>
            <p className="mb-4 text-sm text-text-secondary">
              This column has {tasks.length} task(s). Deleting it will also remove all tasks.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowDeleteConfirm(false); }}
                className="rounded px-4 py-2 text-sm text-text-secondary hover:bg-surface-hover"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                className="rounded bg-error px-4 py-2 text-sm font-medium text-white"
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
