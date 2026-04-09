import { useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import type { Task } from '@/types'
import * as ipc from '@/lib/ipc'
import { useTaskStore } from '@/stores/task-store'
import { DependenciesTab, type Dependency } from './task-dependencies-tab'
import { parseDependencies, parseOverrides } from './task-dependency-utils'

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
  const [model, setModel] = useState(task.model ?? '')
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

      // Save model separately if changed
      if (model !== (task.model ?? '')) {
        await ipc.updateTask(task.id, { model: model || null })
      }

      const updated = await ipc.updateTaskTriggers(task.id, {
        triggerOverrides: JSON.stringify(newOverrides),
        triggerPrompt: triggerPrompt || null,
        dependencies: JSON.stringify(deps),
      })
      updateTask(task.id, updated)
      onClose()
    } catch (err) {
      console.error('Failed to save task settings:', err)
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
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-default px-5 py-3">
          <h2 className="text-sm font-medium text-text-primary">
            Task Settings
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1 text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
          >
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-border-default px-5">
          {(['triggers', 'dependencies'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => { setTab(t) }}
              className={`px-3 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
                tab === t
                  ? 'border-accent text-accent'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
            >
              {t === 'triggers' ? 'Triggers' : 'Dependencies'}
              {t === 'dependencies' && deps.length > 0 && (
                <span className="ml-1.5 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
                  {deps.length}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="max-h-[60vh] overflow-y-auto px-5 py-4">
          <AnimatePresence mode="wait">
            {tab === 'triggers' ? (
              <motion.div key="triggers" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <TriggersTab
                  skipTriggers={skipTriggers}
                  setSkipTriggers={setSkipTriggers}
                  triggerPrompt={triggerPrompt}
                  setTriggerPrompt={setTriggerPrompt}
                  model={model}
                  setModel={setModel}
                  lastOutput={task.lastOutput}
                />
              </motion.div>
            ) : (
              <motion.div key="deps" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <DependenciesTab
                  deps={deps}
                  blocked={task.blocked}
                  taskId={task.id}
                  onDepsChange={setDeps}
                />
              </motion.div>
            )}
          </AnimatePresence>
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
            onClick={() => { void handleSave() }}
            disabled={isSubmitting}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg transition-colors hover:bg-accent/90 disabled:opacity-50"
          >
            {isSubmitting ? 'Saving...' : 'Save'}
          </button>
        </div>
      </motion.div>
    </div>
  )
}

// ─── Triggers Tab ───────────────────────────────────────────────────────────

function TriggersTab({
  skipTriggers,
  setSkipTriggers,
  triggerPrompt,
  setTriggerPrompt,
  model,
  setModel,
  lastOutput,
}: {
  skipTriggers: boolean
  setSkipTriggers: (v: boolean) => void
  triggerPrompt: string
  setTriggerPrompt: (v: string) => void
  model: string
  setModel: (v: string) => void
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

      {/* Model Override */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-text-secondary">
          Model
        </label>
        <p className="mb-2 text-xs text-text-secondary">
          Override the AI model for this task. Leave on Auto to use the column trigger default.
        </p>
        <select
          value={model}
          onChange={(e) => { setModel(e.target.value) }}
          className="w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
        >
          <option value="">Auto (column default)</option>
          <option value="opus">Opus (most capable)</option>
          <option value="sonnet">Sonnet (fast + capable)</option>
          <option value="haiku">Haiku (quick + light)</option>
        </select>
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
