import { useMemo, useState } from 'react'
import { motion } from 'motion/react'
import type { AgentRuntimeMode } from '@/types'
import { useTaskStore } from '@/stores/task-store'
import { useColumnStore } from '@/stores/column-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { DependenciesTab } from './task-dependencies-tab'
import { TaskOptionFields } from './task-option-fields'
import type { Dependency } from './task-dependency-parsers'

// ─── Full new-task surface ────────────────────────────────────────────────────
//
// Exposes every option an agent/MCP can set at creation (model, runtime mode,
// target column, priority, trigger prompt, dependencies) so a human creating a
// task by hand has the same reach. Threads through useTaskStore.add → the
// createTask `CreateTaskOptions` bag.

type TaskCreateDialogProps = {
  /** Column the task lands in by default (user can re-target). */
  columnId: string
  /** Pre-fill the title (e.g. carried over from the inline quick-add). */
  initialTitle?: string
  onClose: () => void
}

export function TaskCreateDialog({ columnId, initialTitle = '', onClose }: TaskCreateDialogProps) {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const addTask = useTaskStore((s) => s.add)
  const columns = useColumnStore((s) => s.columns)

  const orderedColumns = useMemo(
    () => [...columns].sort((a, b) => a.position - b.position),
    [columns],
  )

  const [title, setTitle] = useState(initialTitle)
  const [description, setDescription] = useState('')
  const [targetColumnId, setTargetColumnId] = useState(columnId)
  const [model, setModel] = useState('')
  const [priority, setPriority] = useState('medium')
  const [runtimeMode, setRuntimeMode] = useState<AgentRuntimeMode | ''>('')
  const [triggerPrompt, setTriggerPrompt] = useState('')
  const [deps, setDeps] = useState<Dependency[]>([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canSubmit = title.trim().length > 0 && !!activeWorkspaceId && !isSubmitting

  const handleSubmit = async () => {
    const trimmed = title.trim()
    if (!trimmed || !activeWorkspaceId) return
    setIsSubmitting(true)
    setError(null)
    try {
      await addTask(activeWorkspaceId, targetColumnId, trimmed, description.trim() || undefined, {
        model: model || undefined,
        priority,
        runtimeModeOverride: runtimeMode || undefined,
        triggerPrompt: triggerPrompt.trim() || undefined,
        dependencies: deps.length > 0 ? JSON.stringify(deps) : undefined,
      })
      onClose()
    } catch (err) {
      console.error('Failed to create task:', err)
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        className="relative w-full max-w-lg rounded-xl border border-border-default bg-surface shadow-xl"
        onClick={(e) => { e.stopPropagation() }}
        role="dialog"
        aria-modal="true"
        aria-label="Create task"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-default px-5 py-3">
          <h2 className="text-sm font-medium text-text-primary">New Task</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-lg p-1 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[65vh] space-y-4 overflow-y-auto px-5 py-4">
          {/* Title */}
          <div>
            <label htmlFor="create-task-title" className="mb-1.5 block text-sm font-medium text-text-secondary">
              Title
            </label>
            <input
              id="create-task-title"
              type="text"
              value={title}
              autoFocus
              onChange={(e) => { setTitle(e.target.value) }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && canSubmit) void handleSubmit()
              }}
              placeholder="Task title..."
              className="w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
            />
          </div>

          {/* Description */}
          <div>
            <label htmlFor="create-task-description" className="mb-1.5 block text-sm font-medium text-text-secondary">
              Description
            </label>
            <textarea
              id="create-task-description"
              value={description}
              onChange={(e) => { setDescription(e.target.value) }}
              placeholder="Optional details for the task..."
              rows={3}
              className="w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
            />
          </div>

          {/* Target column */}
          <div>
            <label htmlFor="create-task-column" className="mb-1.5 block text-sm font-medium text-text-secondary">
              Column
            </label>
            <select
              id="create-task-column"
              value={targetColumnId}
              onChange={(e) => { setTargetColumnId(e.target.value) }}
              className="w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
            >
              {orderedColumns.map((col) => (
                <option key={col.id} value={col.id}>{col.name}</option>
              ))}
            </select>
          </div>

          {/* Model + priority + runtime (shared create/edit controls) */}
          <TaskOptionFields
            idPrefix="create-task"
            model={model}
            onModelChange={setModel}
            priority={priority}
            onPriorityChange={setPriority}
            runtimeMode={runtimeMode}
            onRuntimeModeChange={setRuntimeMode}
          />

          {/* Trigger prompt */}
          <div>
            <label htmlFor="create-task-trigger-prompt" className="mb-1.5 block text-sm font-medium text-text-secondary">
              Trigger Prompt
            </label>
            <p className="mb-2 text-xs text-text-secondary">
              Custom prompt fed to the agent when this task&apos;s column trigger fires.
              Overrides the column&apos;s default prompt template.
            </p>
            <textarea
              id="create-task-trigger-prompt"
              value={triggerPrompt}
              onChange={(e) => { setTriggerPrompt(e.target.value) }}
              placeholder="Custom instructions for this task..."
              rows={4}
              className="w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none font-mono"
            />
          </div>

          {/* Dependencies (create mode — no id yet) */}
          <div className="border-t border-border-default pt-4">
            <DependenciesTab
              deps={deps}
              blocked={false}
              taskId={null}
              onDepsChange={setDeps}
            />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 border-t border-border-default px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => { void handleSubmit() }}
            disabled={!canSubmit}
            style={{ cursor: canSubmit ? undefined : 'not-allowed' }}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg transition-colors hover:bg-accent/90 disabled:opacity-50"
          >
            {isSubmitting ? 'Creating...' : 'Create Task'}
          </button>
        </div>
      </motion.div>
    </div>
  )
}
