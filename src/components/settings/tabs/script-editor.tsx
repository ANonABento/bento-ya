import { useState } from 'react'
import type { Script, ScriptStep } from '@/types'
import { parseSteps } from '@/types'
import * as ipc from '@/lib/ipc'
import { STEP_TYPE_COLORS } from '@/components/kanban/column-config-constants'

// ─── Template variable chips ─────────────────────────────────────────────────

const TEMPLATE_VARS: { key: string; label: string; hint: string }[] = [
  { key: '{task.title}', label: 'task.title', hint: 'Task name' },
  { key: '{task.description}', label: 'task.description', hint: 'Task description' },
  { key: '{task.trigger_prompt}', label: 'task.trigger_prompt', hint: 'Trigger prompt' },
  { key: '{column.name}', label: 'column.name', hint: 'Column name' },
  { key: '{workspace.path}', label: 'workspace.path', hint: 'Repo directory' },
]

function TemplateVarChip({ varKey, label, hint }: { varKey: string; label: string; hint: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    void navigator.clipboard.writeText(varKey).then(() => {
      setCopied(true)
      setTimeout(() => { setCopied(false) }, 1500)
    })
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      title={`${hint} — click to copy`}
      className="group flex items-center gap-1 rounded bg-surface px-1.5 py-0.5 font-mono text-[10px] text-text-secondary transition-colors hover:bg-accent/10 hover:text-accent"
    >
      {copied ? (
        <span className="text-green-400">✓ copied</span>
      ) : (
        <>
          <span>{'{' + label + '}'}</span>
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" fill="currentColor" className="h-2.5 w-2.5 opacity-0 transition-opacity group-hover:opacity-100">
            <path d="M7.5 1.5A1.5 1.5 0 0 0 6 0H2.25A1.5 1.5 0 0 0 .75 1.5v6A1.5 1.5 0 0 0 2.25 9H3V3.75A2.25 2.25 0 0 1 5.25 1.5H7.5Z" />
            <path d="M5.25 3a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 5.25 12H9a1.5 1.5 0 0 0 1.5-1.5V7.5h-2.25A1.5 1.5 0 0 1 6.75 6V3H5.25Z" />
            <path d="M8.25 3V6h2.25L8.25 3Z" />
          </svg>
        </>
      )}
    </button>
  )
}

// ─── Step type metadata ───────────────────────────────────────────────────────

const STEP_TYPES: { type: ScriptStep['type']; label: string; hint: string }[] = [
  { type: 'bash', label: 'Bash', hint: 'Shell command' },
  { type: 'agent', label: 'Agent', hint: 'AI prompt' },
  { type: 'check', label: 'Check', hint: 'Assert exit code' },
]

// ─── Script Editor Modal ──────────────────────────────────────────────────────

type ScriptEditorProps = {
  script: Script | null
  onSave: () => void
  onCancel: () => void
}

export function ScriptEditor({ script, onSave, onCancel }: ScriptEditorProps) {
  const [name, setName] = useState(script?.name ?? '')
  const [description, setDescription] = useState(script?.description ?? '')
  const [steps, setSteps] = useState<ScriptStep[]>(script ? parseSteps(script.steps) : [])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const addStep = (type: ScriptStep['type']) => {
    if (type === 'bash') {
      setSteps((prev) => [...prev, { type: 'bash', name: '', command: '' }])
    } else if (type === 'agent') {
      setSteps((prev) => [...prev, { type: 'agent', name: '', prompt: '' }])
    } else {
      setSteps((prev) => [...prev, { type: 'check', name: '', command: '' }])
    }
  }

  const updateStep = (index: number, updated: ScriptStep) => {
    setSteps((prev) => prev.map((s, i) => (i === index ? updated : s)))
  }

  const removeStep = (index: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== index))
  }

  const duplicateStep = (index: number) => {
    setSteps((prev) => {
      const step = prev[index]
      if (!step) return prev
      const copy = [...prev]
      copy.splice(index + 1, 0, { ...step } as ScriptStep)
      return copy
    })
  }

  const moveStep = (index: number, direction: -1 | 1) => {
    const target = index + direction
    if (target < 0 || target >= steps.length) return
    setSteps((prev) => {
      const copy = [...prev]
      ;[copy[index], copy[target]] = [copy[target] as ScriptStep, copy[index] as ScriptStep]
      return copy
    })
  }

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    if (steps.length === 0) {
      setError('Add at least one step')
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
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-border-default bg-bg shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-default px-5 py-4">
          <h3 className="text-base font-semibold text-text-primary">
            {script ? 'Edit Script' : 'New Script'}
          </h3>
          <button
            type="button"
            onClick={onCancel}
            className="rounded p-1 text-text-secondary hover:bg-surface hover:text-text-primary"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
              <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="space-y-4">
            {/* Name */}
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">
                Name <span className="text-error">*</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => { setName(e.target.value) }}
                placeholder="e.g. Run Tests"
                autoFocus
                className="w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
              />
            </div>

            {/* Description */}
            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">
                Description
              </label>
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
              <div className="mb-2 flex items-center justify-between">
                <label className="text-xs font-medium text-text-secondary">
                  Steps {steps.length > 0 && <span className="ml-1 tabular-nums text-text-secondary/60">({steps.length})</span>}
                </label>
              </div>

              {steps.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border-default py-6 text-center">
                  <p className="text-xs text-text-secondary">No steps yet</p>
                  <p className="mt-0.5 text-[11px] text-text-secondary/60">
                    Add a Bash command, Agent prompt, or Check assertion below.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {steps.map((step, i) => (
                    <StepEditor
                      key={i}
                      index={i}
                      step={step}
                      total={steps.length}
                      onUpdate={(s) => { updateStep(i, s) }}
                      onRemove={() => { removeStep(i) }}
                      onDuplicate={() => { duplicateStep(i) }}
                      onMove={(dir) => { moveStep(i, dir) }}
                    />
                  ))}
                </div>
              )}

              {/* Add step buttons */}
              <div className="mt-3 flex flex-wrap gap-2">
                {STEP_TYPES.map(({ type, label, hint }) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => { addStep(type) }}
                    title={hint}
                    className={`flex items-center gap-1 rounded-lg border border-border-default px-2.5 py-1.5 text-xs text-text-secondary transition-colors ${
                      type === 'bash'
                        ? 'hover:border-blue-400 hover:text-blue-400'
                        : type === 'agent'
                          ? 'hover:border-purple-400 hover:text-purple-400'
                          : 'hover:border-amber-400 hover:text-amber-400'
                    }`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" fill="currentColor" className="h-3 w-3">
                      <path d="M6.75 2.75a.75.75 0 0 0-1.5 0v2.5h-2.5a.75.75 0 0 0 0 1.5h2.5v2.5a.75.75 0 0 0 1.5 0v-2.5h2.5a.75.75 0 0 0 0-1.5h-2.5v-2.5Z" />
                    </svg>
                    {label}
                    <span className="text-text-secondary/50">· {hint}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Template variables */}
            <div className="rounded-lg bg-surface/50 p-3">
              <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-text-secondary">
                Template Variables — click to copy
              </p>
              <div className="flex flex-wrap gap-1">
                {TEMPLATE_VARS.map(({ key, label, hint }) => (
                  <TemplateVarChip key={key} varKey={key} label={label} hint={hint} />
                ))}
              </div>
            </div>

            {/* Error */}
            {error && <p className="text-xs text-error">{error}</p>}
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex justify-end gap-2 border-t border-border-default px-5 py-3">
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
            {saving ? 'Saving…' : 'Save Script'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Step Editor ─────────────────────────────────────────────────────────────

function StepEditor({
  index,
  step,
  total,
  onUpdate,
  onRemove,
  onDuplicate,
  onMove,
}: {
  index: number
  step: ScriptStep
  total: number
  onUpdate: (s: ScriptStep) => void
  onRemove: () => void
  onDuplicate: () => void
  onMove: (dir: -1 | 1) => void
}) {
  return (
    <div className="rounded-lg border border-border-default bg-surface/30 p-3">
      {/* Step header */}
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${STEP_TYPE_COLORS[step.type] ?? ''}`}>
            {step.type}
          </span>
          <span className="text-[11px] text-text-secondary">Step {index + 1}</span>
        </div>
        <div className="flex items-center gap-0.5">
          <button
            type="button"
            disabled={index === 0}
            onClick={() => { onMove(-1) }}
            title="Move up"
            className="rounded p-0.5 text-text-secondary hover:text-text-primary disabled:opacity-30"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
              <path fillRule="evenodd" d="M8 14a.75.75 0 0 1-.75-.75V4.56L4.03 7.78a.75.75 0 0 1-1.06-1.06l4.5-4.5a.75.75 0 0 1 1.06 0l4.5 4.5a.75.75 0 0 1-1.06 1.06L8.75 4.56v8.69A.75.75 0 0 1 8 14Z" clipRule="evenodd" />
            </svg>
          </button>
          <button
            type="button"
            disabled={index === total - 1}
            onClick={() => { onMove(1) }}
            title="Move down"
            className="rounded p-0.5 text-text-secondary hover:text-text-primary disabled:opacity-30"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
              <path fillRule="evenodd" d="M8 2a.75.75 0 0 1 .75.75v8.69l3.22-3.22a.75.75 0 1 1 1.06 1.06l-4.5 4.5a.75.75 0 0 1-1.06 0l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.22 3.22V2.75A.75.75 0 0 1 8 2Z" clipRule="evenodd" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onDuplicate}
            title="Duplicate step"
            className="rounded p-0.5 text-text-secondary hover:text-text-primary"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
              <path d="M7.25 1.75A1.75 1.75 0 0 1 9 0h4.25A1.75 1.75 0 0 1 15 1.75v4.25A1.75 1.75 0 0 1 13.25 7.75h-.5V9A1.75 1.75 0 0 1 11 10.75H9.25v.5A1.75 1.75 0 0 1 7.5 13H3.25A1.75 1.75 0 0 1 1.5 11.25V7A1.75 1.75 0 0 1 3.25 5.25h.5V3.5A1.75 1.75 0 0 1 5.5 1.75h1.75Zm.5 1.5H5.5a.25.25 0 0 0-.25.25v1.75h.5A1.75 1.75 0 0 1 7.5 7v2.25h3.5A.25.25 0 0 0 11.25 9V7.75H9A1.75 1.75 0 0 1 7.25 6V3.25ZM3.25 6.75a.25.25 0 0 0-.25.25v4.25c0 .138.112.25.25.25H7.5a.25.25 0 0 0 .25-.25V7a.25.25 0 0 0-.25-.25H3.25Z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={onRemove}
            title="Remove step"
            className="rounded p-0.5 text-text-secondary hover:text-error"
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
        value={step.name ?? ''}
        onChange={(e) => { onUpdate({ ...step, name: e.target.value }) }}
        placeholder="Step label (optional)"
        className="mb-2 w-full rounded border border-border-default bg-bg px-2 py-1 text-xs text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
      />

      {/* Type-specific fields */}
      {(step.type === 'bash' || step.type === 'check') && (
        <div className="space-y-2">
          <input
            type="text"
            value={step.command}
            onChange={(e) => { onUpdate({ ...step, command: e.target.value }) }}
            placeholder={step.type === 'bash' ? 'e.g. npm test' : 'e.g. test -f dist/index.js'}
            className="w-full rounded border border-border-default bg-bg px-2 py-1 font-mono text-xs text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
          />
          {step.type === 'check' && (
            <input
              type="text"
              value={step.failMessage ?? ''}
              onChange={(e) => { onUpdate({ ...step, failMessage: e.target.value }) }}
              placeholder="Failure message (shown when check fails)"
              className="w-full rounded border border-border-default bg-bg px-2 py-1 text-xs text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
            />
          )}
          {step.type === 'bash' && (
            <label className="flex cursor-pointer items-center gap-1.5 text-[11px] text-text-secondary">
              <input
                type="checkbox"
                checked={step.continueOnError ?? false}
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
            placeholder="Prompt for the AI agent — use template variables like {task.title}"
            rows={3}
            className="w-full rounded border border-border-default bg-bg px-2 py-1 text-xs text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={step.command ?? ''}
              onChange={(e) => { onUpdate({ ...step, command: e.target.value }) }}
              placeholder="CLI command (e.g. claude)"
              className="rounded border border-border-default bg-bg px-2 py-1 font-mono text-xs text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
            />
            <select
              value={step.model ?? ''}
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
