import { useState, useEffect, useCallback } from 'react'
import type { Script, ScriptStep } from '@/types'
import { parseSteps } from '@/types'
import * as ipc from '@/lib/ipc'
import { STEP_TYPE_COLORS } from '@/components/kanban/column-config-constants'

// ─── Scripts Tab ────────────────────────────────────────────────────────────

export function ScriptsTab() {
  const [scripts, setScripts] = useState<Script[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<Script | null>(null)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    const s = await ipc.listScripts()
    setScripts(s)
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const handleDelete = async (id: string) => {
    const script = scripts.find((s) => s.id === id)
    if (!script || !window.confirm(`Delete script "${script.name}"?`)) return
    try {
      await ipc.deleteScript(id)
      void load()
    } catch (err) {
      console.error('Failed to delete script:', err)
    }
  }

  if (loading) {
    return <div className="text-sm text-text-secondary">Loading scripts...</div>
  }

  const builtIn = scripts.filter((s) => s.isBuiltIn)
  const custom = scripts.filter((s) => !s.isBuiltIn)

  return (
    <div className="space-y-4">
      {/* Built-in scripts */}
      {builtIn.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-medium uppercase tracking-wider text-text-secondary">
            Built-in
          </h4>
          <div className="space-y-2">
            {builtIn.map((s) => (
              <ScriptCard key={s.id} script={s} />
            ))}
          </div>
        </div>
      )}

      {/* Custom scripts */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-xs font-medium uppercase tracking-wider text-text-secondary">
            Custom
          </h4>
          <button
            type="button"
            onClick={() => { setCreating(true) }}
            className="rounded-lg bg-accent px-2.5 py-1 text-xs font-medium text-bg transition-opacity hover:opacity-90"
          >
            + New Script
          </button>
        </div>
        {custom.length === 0 && !creating && (
          <p className="text-sm text-text-secondary">
            No custom scripts yet. Create one to automate your pipeline.
          </p>
        )}
        <div className="space-y-2">
          {custom.map((s) => (
            <ScriptCard
              key={s.id}
              script={s}
              onEdit={() => { setEditing(s) }}
              onDelete={() => { void handleDelete(s.id) }}
            />
          ))}
        </div>
      </div>

      {/* Editor modal */}
      {(editing || creating) && (
        <ScriptEditor
          script={editing}
          onSave={() => {
            setEditing(null)
            setCreating(false)
            void load()
          }}
          onCancel={() => {
            setEditing(null)
            setCreating(false)
          }}
        />
      )}
    </div>
  )
}

// ─── Script Card ────────────────────────────────────────────────────────────

function ScriptCard({
  script,
  onEdit,
  onDelete,
}: {
  script: Script
  onEdit?: () => void
  onDelete?: () => void
}) {
  const steps = parseSteps(script.steps)

  return (
    <div className="rounded-lg border border-border-default bg-surface/50 p-3">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-text-primary">{script.name}</span>
            {script.isBuiltIn && (
              <span className="rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                built-in
              </span>
            )}
          </div>
          <p className="mt-0.5 text-xs text-text-secondary">{script.description}</p>
        </div>
        {!script.isBuiltIn && (
          <div className="flex gap-1">
            {onEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="rounded p-1 text-text-secondary hover:bg-surface hover:text-text-primary"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                  <path d="M13.488 2.513a1.75 1.75 0 0 0-2.475 0L6.15 7.375a.75.75 0 0 0-.188.335l-.8 3.2a.5.5 0 0 0 .607.607l3.2-.8a.75.75 0 0 0 .335-.188l4.862-4.862a1.75 1.75 0 0 0 0-2.475Z" />
                </svg>
              </button>
            )}
            {onDelete && (
              <button
                type="button"
                onClick={onDelete}
                className="rounded p-1 text-text-secondary hover:bg-error/10 hover:text-error"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                  <path fillRule="evenodd" d="M5 3.25V4H2.75a.75.75 0 0 0 0 1.5h.3l.815 8.15A1.5 1.5 0 0 0 5.357 15h5.285a1.5 1.5 0 0 0 1.493-1.35l.815-8.15h.3a.75.75 0 0 0 0-1.5H11v-.75A2.25 2.25 0 0 0 8.75 1h-1.5A2.25 2.25 0 0 0 5 3.25Zm2.25-.75a.75.75 0 0 0-.75.75V4h3v-.75a.75.75 0 0 0-.75-.75h-1.5ZM6.05 6a.75.75 0 0 1 .787.713l.275 5.5a.75.75 0 0 1-1.498.075l-.275-5.5A.75.75 0 0 1 6.05 6Zm3.9 0a.75.75 0 0 1 .712.787l-.275 5.5a.75.75 0 0 1-1.498-.075l.275-5.5A.75.75 0 0 1 9.95 6Z" clipRule="evenodd" />
                </svg>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Steps preview */}
      <div className="mt-2 flex flex-wrap gap-1">
        {steps.map((step, i) => (
          <span
            key={i}
            className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium ${STEP_TYPE_COLORS[step.type] || 'bg-surface text-text-secondary'}`}
          >
            {step.name || step.type}
          </span>
        ))}
      </div>
    </div>
  )
}

// ─── Script Editor Modal ────────────────────────────────────────────────────

function ScriptEditor({
  script,
  onSave,
  onCancel,
}: {
  script: Script | null
  onSave: () => void
  onCancel: () => void
}) {
  const [name, setName] = useState(script?.name || '')
  const [description, setDescription] = useState(script?.description || '')
  const [steps, setSteps] = useState<ScriptStep[]>(script ? parseSteps(script.steps) : [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const addStep = (type: ScriptStep['type']) => {
    if (type === 'bash') {
      setSteps([...steps, { type: 'bash', name: '', command: '' }])
    } else if (type === 'agent') {
      setSteps([...steps, { type: 'agent', name: '', prompt: '' }])
    } else {
      setSteps([...steps, { type: 'check', name: '', command: '' }])
    }
  }

  const updateStep = (index: number, updated: ScriptStep) => {
    const copy = [...steps]
    copy[index] = updated
    setSteps(copy)
  }

  const removeStep = (index: number) => {
    setSteps(steps.filter((_, i) => i !== index))
  }

  const moveStep = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= steps.length) return
    const copy = [...steps]
    ;[copy[index], copy[target]] = [copy[target] as ScriptStep, copy[index] as ScriptStep]
    setSteps(copy)
  }

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    if (steps.length === 0) {
      setError('At least one step is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const stepsJson = JSON.stringify(steps)
      if (script) {
        await ipc.updateScript(script.id, { name: name.trim(), description, steps: stepsJson })
      } else {
        await ipc.createScript(name.trim(), description, stepsJson)
      }
      onSave()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel() }}
      onKeyDown={(e) => { if (e.key === 'Escape') onCancel() }}
    >
      <div className="w-full max-w-lg rounded-xl border border-border-default bg-bg p-6 shadow-2xl max-h-[80vh] overflow-y-auto">
        <h3 className="mb-4 text-base font-semibold text-text-primary">
          {script ? 'Edit Script' : 'New Script'}
        </h3>

        <div className="space-y-4">
          {/* Name */}
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value) }}
              placeholder="My Script"
              className="w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
            />
          </div>

          {/* Description */}
          <div>
            <label className="mb-1 block text-xs font-medium text-text-secondary">Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => { setDescription(e.target.value) }}
              placeholder="What does this script do?"
              className="w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
            />
          </div>

          {/* Steps */}
          <div>
            <label className="mb-2 block text-xs font-medium text-text-secondary">Steps</label>
            <div className="space-y-2">
              {steps.map((step, i) => (
                <StepEditor
                  key={i}
                  index={i}
                  step={step}
                  total={steps.length}
                  onUpdate={(s) => { updateStep(i, s) }}
                  onRemove={() => { removeStep(i) }}
                  onMove={(dir) => { moveStep(i, dir) }}
                />
              ))}
            </div>

            {/* Add step buttons */}
            <div className="mt-2 flex gap-2">
              <button
                type="button"
                onClick={() => { addStep('bash') }}
                className="rounded-lg border border-border-default px-2.5 py-1.5 text-xs text-text-secondary hover:border-blue-400 hover:text-blue-400"
              >
                + Bash
              </button>
              <button
                type="button"
                onClick={() => { addStep('agent') }}
                className="rounded-lg border border-border-default px-2.5 py-1.5 text-xs text-text-secondary hover:border-purple-400 hover:text-purple-400"
              >
                + Agent
              </button>
              <button
                type="button"
                onClick={() => { addStep('check') }}
                className="rounded-lg border border-border-default px-2.5 py-1.5 text-xs text-text-secondary hover:border-amber-400 hover:text-amber-400"
              >
                + Check
              </button>
            </div>
          </div>

          {/* Template variables help */}
          <div className="rounded-lg bg-surface/50 p-3">
            <p className="text-[10px] font-medium uppercase tracking-wider text-text-secondary mb-1">
              Template Variables
            </p>
            <p className="text-xs text-text-secondary font-mono">
              {'{task.title}'} {'{task.description}'} {'{task.trigger_prompt}'} {'{column.name}'} {'{workspace.path}'}
            </p>
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-error">{error}</p>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-border-default px-4 py-2 text-sm text-text-secondary hover:text-text-primary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => { void handleSave() }}
              disabled={saving}
              className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg transition-opacity disabled:opacity-50"
            >
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Step Editor ────────────────────────────────────────────────────────────

function StepEditor({
  index,
  step,
  total,
  onUpdate,
  onRemove,
  onMove,
}: {
  index: number
  step: ScriptStep
  total: number
  onUpdate: (s: ScriptStep) => void
  onRemove: () => void
  onMove: (dir: -1 | 1) => void
}) {
  return (
    <div className="rounded-lg border border-border-default bg-surface/30 p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STEP_TYPE_COLORS[step.type] || ''}`}>
            {step.type}
          </span>
          <span className="text-xs text-text-secondary">Step {index + 1}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={index === 0}
            onClick={() => { onMove(-1) }}
            className="rounded p-0.5 text-text-secondary hover:text-text-primary disabled:opacity-30"
            title="Move up"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
              <path fillRule="evenodd" d="M8 14a.75.75 0 0 1-.75-.75V4.56L4.03 7.78a.75.75 0 0 1-1.06-1.06l4.5-4.5a.75.75 0 0 1 1.06 0l4.5 4.5a.75.75 0 0 1-1.06 1.06L8.75 4.56v8.69A.75.75 0 0 1 8 14Z" clipRule="evenodd" />
            </svg>
          </button>
          <button
            type="button"
            disabled={index === total - 1}
            onClick={() => { onMove(1) }}
            className="rounded p-0.5 text-text-secondary hover:text-text-primary disabled:opacity-30"
            title="Move down"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
              <path fillRule="evenodd" d="M8 2a.75.75 0 0 1 .75.75v8.69l3.22-3.22a.75.75 0 1 1 1.06 1.06l-4.5 4.5a.75.75 0 0 1-1.06 0l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.22 3.22V2.75A.75.75 0 0 1 8 2Z" clipRule="evenodd" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onRemove}
            className="rounded p-0.5 text-text-secondary hover:text-error"
            title="Remove step"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
              <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Step name */}
      <input
        type="text"
        value={step.name || ''}
        onChange={(e) => { onUpdate({ ...step, name: e.target.value }) }}
        placeholder="Step name"
        className="mb-2 w-full rounded border border-border-default bg-bg px-2 py-1 text-xs text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
      />

      {/* Type-specific fields */}
      {(step.type === 'bash' || step.type === 'check') && (
        <div className="space-y-2">
          <input
            type="text"
            value={step.command}
            onChange={(e) => { onUpdate({ ...step, command: e.target.value }) }}
            placeholder="Command (e.g. npm test)"
            className="w-full rounded border border-border-default bg-bg px-2 py-1 text-xs text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none font-mono"
          />
          {step.type === 'check' && (
            <input
              type="text"
              value={step.failMessage || ''}
              onChange={(e) => { onUpdate({ ...step, failMessage: e.target.value }) }}
              placeholder="Failure message"
              className="w-full rounded border border-border-default bg-bg px-2 py-1 text-xs text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
            />
          )}
          {step.type === 'bash' && (
            <label className="flex items-center gap-1.5 text-[10px] text-text-secondary">
              <input
                type="checkbox"
                checked={step.continueOnError || false}
                onChange={(e) => { onUpdate({ ...step, continueOnError: e.target.checked }) }}
                className="h-3 w-3 rounded accent-accent"
              />
              Continue on error
            </label>
          )}
        </div>
      )}

      {step.type === 'agent' && (
        <div className="space-y-2">
          <textarea
            value={step.prompt}
            onChange={(e) => { onUpdate({ ...step, prompt: e.target.value }) }}
            placeholder="Agent prompt"
            rows={2}
            className="w-full rounded border border-border-default bg-bg px-2 py-1 text-xs text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={step.command || ''}
              onChange={(e) => { onUpdate({ ...step, command: e.target.value }) }}
              placeholder="Command (e.g. /start-task)"
              className="rounded border border-border-default bg-bg px-2 py-1 text-xs text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none font-mono"
            />
            <select
              value={step.model || ''}
              onChange={(e) => { onUpdate({ ...step, model: e.target.value || undefined }) }}
              className="rounded border border-border-default bg-bg px-2 py-1 text-xs text-text-primary focus:border-accent focus:outline-none"
            >
              <option value="">Default model</option>
              <option value="opus">Opus</option>
              <option value="sonnet">Sonnet</option>
              <option value="haiku">Haiku</option>
            </select>
          </div>
        </div>
      )}
    </div>
  )
}
