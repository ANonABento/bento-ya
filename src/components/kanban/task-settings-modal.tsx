import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import type { Task } from '@/types'
import * as ipc from '@/lib/ipc'
import { useTaskStore } from '@/stores/task-store'
import { useColumnStore } from '@/stores/column-store'

// ─── Types ──────────────────────────────────────────────────────────────────

type TaskSettingsModalProps = {
  task: Task
  onClose: () => void
  initialTab?: Tab
}

type Tab = 'triggers' | 'dependencies'

// ─── Main Component ─────────────────────────────────────────────────────────

export function TaskSettingsModal({ task, onClose, initialTab }: TaskSettingsModalProps) {
  const [tab, setTab] = useState<Tab>(initialTab ?? 'triggers')
  const updateTask = useTaskStore((s) => s.updateTask)

  // Parse trigger overrides
  const overrides = parseOverrides(task.triggerOverrides)
  const [skipTriggers, setSkipTriggers] = useState(overrides.skip_triggers === true)
  const [triggerPrompt, setTriggerPrompt] = useState(task.triggerPrompt ?? '')
  const [isSubmitting, setIsSubmitting] = useState(false)

  // Parse dependencies — held as state for interactive editing
  const [deps, setDeps] = useState<Dependency[]>(() => parseDependencies(task.dependencies))

  const handleSave = async () => {
    setIsSubmitting(true)
    try {
      const newOverrides = {
        ...overrides,
        skip_triggers: skipTriggers,
      }

      const updated = await ipc.updateTaskTriggers(task.id, {
        triggerOverrides: JSON.stringify(newOverrides),
        triggerPrompt: triggerPrompt || null,
        dependencies: JSON.stringify(deps),
        blocked: deps.length > 0 ? true : undefined, // new deps start blocked; backend resolves on next trigger
      })
      updateTask(updated.id, updated)
      onClose()
    } catch (err) {
      console.error('Failed to save task settings:', err)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="flex max-h-[80vh] w-[500px] flex-col overflow-hidden rounded-xl border border-border-default bg-surface shadow-2xl"
          onClick={(e) => { e.stopPropagation() }}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border-default px-6 py-4">
            <div>
              <h2 className="text-base font-semibold text-text-primary">
                Configure Task
              </h2>
              <p className="mt-0.5 text-xs text-text-secondary truncate max-w-[350px]">
                {task.title}
              </p>
            </div>
            <button
              onClick={onClose}
              className="rounded-lg p-1 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
            >
              <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
              </svg>
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-border-default px-6">
            {(['triggers', 'dependencies'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t) }}
                className={`px-4 py-3 text-sm font-medium transition-colors relative ${
                  tab === t
                    ? 'text-accent'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
                {tab === t && (
                  <motion.div
                    layoutId="task-tab-indicator"
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent"
                  />
                )}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-6">
            {tab === 'triggers' && (
              <TriggersTab
                skipTriggers={skipTriggers}
                setSkipTriggers={setSkipTriggers}
                triggerPrompt={triggerPrompt}
                setTriggerPrompt={setTriggerPrompt}
                lastOutput={task.lastOutput}
              />
            )}

            {tab === 'dependencies' && (
              <DependenciesTab
                deps={deps}
                blocked={task.blocked}
                taskId={task.id}
                onDepsChange={setDeps}
              />
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-end gap-3 border-t border-border-default px-6 py-4">
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-4 py-2 text-sm font-medium text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => { void handleSave() }}
              disabled={isSubmitting}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
            >
              {isSubmitting ? 'Saving...' : 'Save'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

// ─── Triggers Tab ───────────────────────────────────────────────────────────

function TriggersTab({
  skipTriggers,
  setSkipTriggers,
  triggerPrompt,
  setTriggerPrompt,
  lastOutput,
}: {
  skipTriggers: boolean
  setSkipTriggers: (v: boolean) => void
  triggerPrompt: string
  setTriggerPrompt: (v: string) => void
  lastOutput: string | null
}) {
  return (
    <div className="space-y-4">
      {/* Skip Triggers Toggle */}
      <div className="flex items-center justify-between rounded-lg border border-border-default px-4 py-3">
        <div>
          <div className="text-sm font-medium text-text-primary">Skip all triggers</div>
          <div className="text-xs text-text-secondary">
            Disable column triggers for this task
          </div>
        </div>
        <button
          type="button"
          onClick={() => { setSkipTriggers(!skipTriggers) }}
          className={`relative h-6 w-11 rounded-full transition-colors ${
            skipTriggers ? 'bg-accent' : 'bg-surface-hover'
          }`}
        >
          <motion.div
            className="absolute top-1 h-4 w-4 rounded-full bg-white shadow"
            animate={{ left: skipTriggers ? 24 : 4 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          />
        </button>
      </div>

      {/* Trigger Prompt */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-text-secondary">
          Trigger Prompt
        </label>
        <p className="mb-2 text-xs text-text-secondary">
          Custom prompt fed to the agent when this task&apos;s column trigger fires.
          Overrides the column&apos;s default prompt template.
        </p>
        <textarea
          value={triggerPrompt}
          onChange={(e) => { setTriggerPrompt(e.target.value) }}
          placeholder="Custom instructions for this task..."
          rows={5}
          className="w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none font-mono"
        />
      </div>

      {/* Last Output (read-only) */}
      {lastOutput && (
        <div>
          <label className="mb-1.5 block text-sm font-medium text-text-secondary">
            Last Agent Output
          </label>
          <div className="max-h-32 overflow-y-auto rounded-lg border border-border-default bg-bg/50 px-3 py-2 text-xs text-text-secondary font-mono whitespace-pre-wrap">
            {lastOutput}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Dependencies Tab ───────────────────────────────────────────────────────

type Dependency = {
  task_id: string
  condition: string
  target_column?: string
  on_met: { type: string; target?: string }
}

function DependenciesTab({
  deps,
  blocked,
  taskId,
  onDepsChange,
}: {
  deps: Dependency[]
  blocked: boolean
  taskId: string
  onDepsChange: (deps: Dependency[]) => void
}) {
  const tasks = useTaskStore((s) => s.tasks)
  const columns = useColumnStore((s) => s.columns)
  const [newTaskId, setNewTaskId] = useState('')
  const [newCondition, setNewCondition] = useState('completed')
  const [newTargetColumn, setNewTargetColumn] = useState('')
  const [newOnMet, setNewOnMet] = useState('none')
  const [validationError, setValidationError] = useState<string | null>(null)
  const [isValidating, setIsValidating] = useState(false)

  // Available tasks = all workspace tasks except self and already-added deps
  const existingDepIds = new Set(deps.map(d => d.task_id))
  const availableTasks = tasks.filter(t => t.id !== taskId && !existingDepIds.has(t.id))

  const getTaskTitle = (id: string) =>
    tasks.find(t => t.id === id)?.title ?? id.slice(0, 8) + '...'

  const handleAdd = async () => {
    if (!newTaskId) return
    setIsValidating(true)
    setValidationError(null)

    const newDep: Dependency = {
      task_id: newTaskId,
      condition: newCondition,
      target_column: newCondition === 'moved_to_column' ? newTargetColumn : undefined,
      on_met: { type: newOnMet, target: newOnMet === 'move_column' ? 'next' : undefined },
    }
    const proposed = [...deps, newDep]

    try {
      await ipc.validateTaskDependencies(taskId, JSON.stringify(proposed))
      onDepsChange(proposed)
      setNewTaskId('')
      setNewCondition('completed')
      setNewOnMet('none')
      setNewTargetColumn('')
      setValidationError(null)
    } catch (err) {
      setValidationError(String(err))
    } finally {
      setIsValidating(false)
    }
  }

  const handleRemove = (index: number) => {
    onDepsChange(deps.filter((_, i) => i !== index))
  }

  // Blocker names for the blocked warning
  const blockerNames = deps
    .map(d => getTaskTitle(d.task_id))
    .join(', ')

  return (
    <div className="space-y-4">
      {/* Blocked Status */}
      {blocked && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3">
          <svg className="h-5 w-5 shrink-0 text-amber-500" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 1a4.5 4.5 0 0 0-4.5 4.5V9H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-.5V5.5A4.5 4.5 0 0 0 10 1Zm3 8V5.5a3 3 0 1 0-6 0V9h6Z" clipRule="evenodd" />
          </svg>
          <div>
            <div className="text-sm font-medium text-amber-500">Task is blocked</div>
            <div className="text-xs text-amber-500/80">
              Waiting for: {blockerNames}
            </div>
          </div>
        </div>
      )}

      {/* Existing Dependencies List */}
      <div>
        <h3 className="mb-2 text-sm font-medium text-text-primary">Depends On</h3>
        {deps.length === 0 ? (
          <p className="text-sm text-text-secondary">
            No dependencies configured. Add one below.
          </p>
        ) : (
          <div className="space-y-2">
            {deps.map((dep, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between rounded-lg border border-border-default px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-text-primary truncate">
                    {getTaskTitle(dep.task_id)}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-text-secondary">
                    <span className="rounded bg-surface-hover px-1.5 py-0.5">
                      {dep.condition}
                    </span>
                    {dep.target_column && (
                      <span className="text-text-secondary/70">
                        column: {columns.find(c => c.id === dep.target_column)?.name ?? dep.target_column}
                      </span>
                    )}
                    {dep.on_met.type !== 'none' && (
                      <span className="text-text-secondary/70">
                        then: {dep.on_met.type}{dep.on_met.target ? ` (${dep.on_met.target})` : ''}
                      </span>
                    )}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => { handleRemove(idx) }}
                  className="ml-2 shrink-0 rounded p-1 text-text-secondary transition-colors hover:bg-red-500/10 hover:text-red-400"
                  title="Remove dependency"
                >
                  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add Dependency Section */}
      <div className="rounded-lg border border-border-default p-3 space-y-3">
        <h4 className="text-sm font-medium text-text-secondary">Add Dependency</h4>

        {/* Task select */}
        <div>
          <label className="mb-1 block text-xs text-text-secondary">Task</label>
          <select
            value={newTaskId}
            onChange={(e) => { setNewTaskId(e.target.value) }}
            className="w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
          >
            <option value="">Select a task...</option>
            {availableTasks.map(t => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </div>

        {/* Condition select */}
        <div>
          <label className="mb-1 block text-xs text-text-secondary">Condition</label>
          <select
            value={newCondition}
            onChange={(e) => { setNewCondition(e.target.value) }}
            className="w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
          >
            <option value="completed">Completed</option>
            <option value="moved_to_column">Moved to column</option>
            <option value="agent_complete">Agent complete</option>
          </select>
        </div>

        {/* Target column (only for moved_to_column) */}
        {newCondition === 'moved_to_column' && (
          <div>
            <label className="mb-1 block text-xs text-text-secondary">Target Column</label>
            <select
              value={newTargetColumn}
              onChange={(e) => { setNewTargetColumn(e.target.value) }}
              className="w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
            >
              <option value="">Select a column...</option>
              {columns.map(c => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* On-met action */}
        <div>
          <label className="mb-1 block text-xs text-text-secondary">When met</label>
          <select
            value={newOnMet}
            onChange={(e) => { setNewOnMet(e.target.value) }}
            className="w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
          >
            <option value="none">Do nothing</option>
            <option value="move_column">Move to next column</option>
          </select>
        </div>

        {/* Validation error */}
        {validationError && (
          <p className="text-xs text-red-400">{validationError}</p>
        )}

        {/* Add button */}
        <button
          type="button"
          onClick={() => { void handleAdd() }}
          disabled={!newTaskId || isValidating}
          className="w-full rounded-lg bg-accent/10 px-3 py-2 text-sm font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isValidating ? 'Validating...' : 'Add Dependency'}
        </button>
      </div>
    </div>
  )
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function parseOverrides(json: string | null): Record<string, unknown> {
  if (!json) return {}
  try {
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return {}
  }
}

function parseDependencies(json: string | null): Dependency[] {
  if (!json) return []
  try {
    return JSON.parse(json) as Dependency[]
  } catch {
    return []
  }
}
