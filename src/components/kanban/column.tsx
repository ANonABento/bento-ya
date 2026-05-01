import { memo, useState, useCallback, useMemo, useRef, useEffect, type ChangeEvent, type MouseEvent as ReactMouseEvent } from 'react'
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
import type { TaskTemplate } from '@/types'
import { queueBacklog, cancelBacklogQueue } from '@/lib/ipc/pipeline'
import { ColumnHeader } from './column-header'
import { TaskCard } from './task-card'
import { ColumnConfigDialog } from './column-config-dialog'
import * as ipc from '@/lib/ipc'

type BatchQueueLocalState = {
  isQueuing: boolean
  total: number
  completed: number
  queuedTaskIds: string[]
}

type ColumnProps = {
  column: ColumnType
  autoOpenConfig?: boolean
  onConfigOpened?: () => void
  selectedTaskIds?: ReadonlySet<string>
  onTaskSelectionChange?: (taskId: string, event: ReactMouseEvent<HTMLElement>) => void
}

export const Column = memo(function Column({
  column,
  autoOpenConfig,
  onConfigOpened,
  selectedTaskIds,
  onTaskSelectionChange,
}: ColumnProps) {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const allTasks = useTaskStore((s) => s.tasks)
  const addTask = useTaskStore((s) => s.add)
  const remove = useColumnStore((s) => s.remove)
  const createFromTemplate = useTaskStore((s) => s.createFromTemplate)
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
  const [showTemplatePicker, setShowTemplatePicker] = useState(false)
  const [templates, setTemplates] = useState<TaskTemplate[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const [newTaskTitle, setNewTaskTitle] = useState('')
  const addTaskInputRef = useRef<HTMLInputElement>(null)
  const [templateTitle, setTemplateTitle] = useState('')
  const [templateDescription, setTemplateDescription] = useState('')
  const [templateLabels, setTemplateLabels] = useState('[]')
  const [templateModel, setTemplateModel] = useState('')

  // Batch queue state
  const [batchQueueState, setBatchQueueState] = useState<BatchQueueLocalState>(
    { isQueuing: false, total: 0, completed: 0, queuedTaskIds: [] }
  )

  // Track completed tasks when batch queue is active
  useEffect(() => {
    if (!batchQueueState.isQueuing || batchQueueState.queuedTaskIds.length === 0) return
    const completedCount = batchQueueState.queuedTaskIds.filter(
      (id) => {
        const task = allTasks.find((t) => t.id === id)
        return task && task.agentStatus !== 'queued'
      }
    ).length
    if (completedCount !== batchQueueState.completed) {
      setBatchQueueState((prev) => ({ ...prev, completed: completedCount }))
    }
    if (completedCount === batchQueueState.total) {
      setBatchQueueState({ isQueuing: false, total: 0, completed: 0, queuedTaskIds: [] })
    }
  }, [allTasks, batchQueueState.isQueuing, batchQueueState.queuedTaskIds, batchQueueState.total, batchQueueState.completed])

  const handleRunAll = useCallback(async () => {
    const ids = tasks.map((t) => t.id)
    if (ids.length === 0) return
    try {
      await queueBacklog(ids)
      setBatchQueueState({ isQueuing: true, total: ids.length, completed: 0, queuedTaskIds: ids })
    } catch (err) {
      console.error('[Column] Failed to queue backlog:', err)
    }
  }, [tasks])

  const handleCancelQueue = useCallback(async () => {
    const remainingIds = batchQueueState.queuedTaskIds.filter((id) => {
      const task = allTasks.find((t) => t.id === id)
      return task && task.agentStatus === 'queued'
    })
    try {
      await cancelBacklogQueue(remainingIds)
    } catch (err) {
      console.error('[Column] Failed to cancel queue:', err)
    }
    setBatchQueueState({ isQueuing: false, total: 0, completed: 0, queuedTaskIds: [] })
  }, [batchQueueState.queuedTaskIds, allTasks])

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

  // Focus input when add task is shown + listen for native input events (WebDriver compat)
  useEffect(() => {
    if (showAddTask) {
      addTaskInputRef.current?.focus()
      const el = addTaskInputRef.current
      if (!el) return
      const handler = () => { setNewTaskTitle(el.value) }
      el.addEventListener('input', handler)
      return () => { el.removeEventListener('input', handler) }
    }
  }, [showAddTask])

  // Auto-open config dialog for newly created columns
  useEffect(() => {
    if (autoOpenConfig) {
      setShowConfigDialog(true)
      onConfigOpened?.()
    }
  }, [autoOpenConfig, onConfigOpened])

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

  const loadTemplates = useCallback(async () => {
    if (!activeWorkspaceId) return
    setTemplatesLoading(true)
    try {
      const nextTemplates = await ipc.listTaskTemplates(activeWorkspaceId)
      setTemplates(nextTemplates)
    } catch (error) {
      console.error('[Column] Failed to load task templates:', error)
      setTemplates([])
    } finally {
      setTemplatesLoading(false)
    }
  }, [activeWorkspaceId])

  useEffect(() => {
    if (showTemplatePicker) {
      void loadTemplates()
    }
  }, [showTemplatePicker, loadTemplates])

  const handleCancelAddTask = useCallback(() => {
    setNewTaskTitle('')
    setShowAddTask(false)
  }, [])

  const handleCreateFromTemplate = useCallback(async (templateId: string) => {
    if (!activeWorkspaceId) return
    await createFromTemplate(activeWorkspaceId, column.id, templateId)
    setShowTemplatePicker(false)
    setTemplateTitle('')
    setTemplateDescription('')
    setTemplateLabels('[]')
    setTemplateModel('')
  }, [activeWorkspaceId, column.id, createFromTemplate])

  const handleSaveTemplate = useCallback(async () => {
    if (!activeWorkspaceId) return
    if (!templateTitle.trim()) return
    try {
      const nextTemplate = await ipc.createTaskTemplate(
        activeWorkspaceId,
        templateTitle.trim(),
        templateDescription || undefined,
        templateLabels || '[]',
        templateModel || undefined,
      )
      setTemplates((prev) => [nextTemplate, ...prev])
      setTemplateTitle('')
      setTemplateDescription('')
      setTemplateLabels('[]')
      setTemplateModel('')
    } catch (error) {
      console.error('[Column] Failed to create template:', error)
    }
  }, [activeWorkspaceId, templateTitle, templateDescription, templateLabels, templateModel])

  const handleDeleteTemplate = useCallback(async (templateId: string) => {
    try {
      await ipc.deleteTaskTemplate(templateId)
      await loadTemplates()
    } catch (error) {
      console.error('[Column] Failed to delete template:', error)
    }
  }, [loadTemplates])

  const handleEditTemplate = useCallback(async (template: TaskTemplate) => {
    const nextTitle = window.prompt('Template title', template.title)
    if (nextTitle === null) return
    const nextDescription = window.prompt('Template description', template.description ?? '')
    if (nextDescription === null) return
    const nextLabels = window.prompt('Template labels (JSON)', template.labels)
    if (nextLabels === null) return
    const nextModel = window.prompt('Template model (optional)', template.model ?? '')

    try {
      const nextTemplate = await ipc.updateTaskTemplate(template.id, {
        title: nextTitle.trim() || template.title,
        description: nextDescription,
        labels: nextLabels,
        model: nextModel || null,
      })
      setTemplates((prev) =>
        prev.map((existing) => (existing.id === nextTemplate.id ? nextTemplate : existing)),
      )
    } catch (error) {
      console.error('[Column] Failed to update template:', error)
    }
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
            isBacklog={column.position === 0}
            batchQueue={batchQueueState.isQueuing ? { total: batchQueueState.total, completed: batchQueueState.completed } : undefined}
            onConfigure={handleConfigure}
            onDelete={handleDelete}
            onAddTask={handleAddTask}
            onCreateFromTemplate={() => { setShowTemplatePicker(true) }}
            onRunAll={() => { void handleRunAll(); }}
            onCancelQueue={() => { void handleCancelQueue(); }}
          />
        </div>

        {showTemplatePicker && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
            onClick={() => { setShowTemplatePicker(false) }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="w-full max-w-xl rounded border border-border-default bg-surface p-4 shadow-xl"
              onClick={(e) => { e.stopPropagation() }}
            >
              <div className="mb-4 flex items-center justify-between">
                <h3 className="text-lg font-semibold text-text-primary">
                  Task templates
                </h3>
                <button
                  onClick={() => { setShowTemplatePicker(false) }}
                  className="rounded px-2 py-1 text-xs text-text-secondary hover:bg-surface-hover"
                >
                  Close
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="text-xs text-text-secondary">
                  Title
                  <input
                    className="mt-1 w-full rounded border border-border-default bg-bg px-2 py-1 text-sm"
                    value={templateTitle}
                    onChange={(e) => { setTemplateTitle(e.target.value) }}
                    placeholder="New template title"
                  />
                </label>
                <label className="text-xs text-text-secondary">
                  Model
                  <input
                    className="mt-1 w-full rounded border border-border-default bg-bg px-2 py-1 text-sm"
                    value={templateModel}
                    onChange={(e) => { setTemplateModel(e.target.value) }}
                    placeholder="Optional model"
                  />
                </label>
              </div>
              <label className="mt-2 block text-xs text-text-secondary">
                Description
                <textarea
                  className="mt-1 min-h-[68px] w-full rounded border border-border-default bg-bg px-2 py-1 text-sm"
                  value={templateDescription}
                  onChange={(e) => { setTemplateDescription(e.target.value) }}
                  placeholder="Template description"
                />
              </label>
              <label className="mt-2 block text-xs text-text-secondary">
                Labels JSON
                <input
                  className="mt-1 w-full rounded border border-border-default bg-bg px-2 py-1 text-sm"
                  value={templateLabels}
                  onChange={(e) => { setTemplateLabels(e.target.value) }}
                  placeholder="[]"
                />
              </label>
              <div className="mt-3 flex justify-end">
                <button
                  onClick={() => {
                    void handleSaveTemplate()
                  }}
                  className="rounded bg-accent px-2.5 py-1 text-xs font-medium text-bg"
                >
                  Save Template
                </button>
              </div>

              <div className="mt-4 max-h-64 overflow-y-auto">
                {templatesLoading ? (
                  <p className="text-xs text-text-secondary">Loading templates...</p>
                ) : templates.length === 0 ? (
                  <p className="text-xs text-text-secondary">No templates yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {templates.map((template) => (
                      <li
                        key={template.id}
                        className="rounded border border-border-default bg-surface-hover p-2"
                      >
                        <div className="mb-2">
                          <div className="text-sm font-medium text-text-primary">
                            {template.title}
                          </div>
                          {template.description && (
                            <p className="text-xs text-text-secondary">{template.description}</p>
                          )}
                          <p className="mt-1 text-[11px] text-text-secondary/80">
                            labels: {template.labels}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-1">
                          <button
                            onClick={() => { void handleCreateFromTemplate(template.id) }}
                            className="rounded bg-accent px-2 py-1 text-xs text-bg"
                          >
                            Create task
                          </button>
                          <button
                            onClick={() => { void handleEditTemplate(template) }}
                            className="rounded bg-surface border border-border-default px-2 py-1 text-xs text-text-secondary"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => {
                              void handleDeleteTemplate(template.id)
                            }}
                            className="rounded bg-error px-2 py-1 text-xs text-white"
                          >
                            Delete
                          </button>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </motion.div>
          </div>
        )}

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
                      onChange={(e: ChangeEvent<HTMLInputElement>) => { setNewTaskTitle(e.target.value); }}
                      data-testid="add-task-input"
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
              tasks.map((task) => (
                <TaskCard
                  key={task.id}
                  task={task}
                  isSelected={selectedTaskIds?.has(task.id) ?? false}
                  onSelectionChange={onTaskSelectionChange}
                />
              ))
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
