import { useState, useEffect, useCallback } from 'react'
import type { Script } from '@/types'
import { parseSteps } from '@/types'
import * as ipc from '@/lib/ipc'
import { STEP_TYPE_COLORS } from '@/components/kanban/column-config-constants'
import { ScriptEditor } from './script-editor'

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
