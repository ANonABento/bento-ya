import { useState, useEffect, useCallback, useRef } from 'react'
import type { Script } from '@/types'
import { parseSteps } from '@/types'
import type { ColumnTriggers, RunScriptAction } from '@/types'
import { getColumnTriggers } from '@/types/column'
import * as ipc from '@/lib/ipc'
import { STEP_TYPE_COLORS } from '@/components/kanban/column-config-constants'
import { ScriptEditor } from './script-editor'
import { useColumnStore } from '@/stores/column-store'
import { useWorkspaceStore } from '@/stores/workspace-store'

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
  const [showAttach, setShowAttach] = useState(false)
  const [attachStatus, setAttachStatus] = useState<string | null>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const columns = useColumnStore((s) => s.columns)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const updateColumnAsync = useColumnStore((s) => s.updateColumnAsync)
  const loadColumns = useColumnStore((s) => s.load)

  // Load columns when dropdown opens
  useEffect(() => {
    if (showAttach && activeWorkspaceId) {
      void loadColumns(activeWorkspaceId)
    }
  }, [showAttach, activeWorkspaceId, loadColumns])

  // Close dropdown on outside click
  useEffect(() => {
    if (!showAttach) return
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowAttach(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => {
      document.removeEventListener('mousedown', handleClick)
    }
  }, [showAttach])

  // Clear status message after a delay
  useEffect(() => {
    if (!attachStatus) return
    const timer = setTimeout(() => {
      setAttachStatus(null)
    }, 2500)
    return () => {
      clearTimeout(timer)
    }
  }, [attachStatus])

  const handleAttach = async (columnId: string, columnName: string) => {
    const column = columns.find((c) => c.id === columnId)
    if (!column) return

    const existing = getColumnTriggers(column)
    const hasExistingEntry = existing.on_entry && existing.on_entry.type !== 'none'

    if (hasExistingEntry) {
      const confirmed = window.confirm(
        `"${columnName}" already has an on_entry trigger. Replace it with this script?`
      )
      if (!confirmed) return
    }

    const newTriggers: ColumnTriggers = {
      ...existing,
      on_entry: { type: 'run_script', script_id: script.id } satisfies RunScriptAction,
    }

    try {
      await updateColumnAsync(columnId, { triggers: JSON.stringify(newTriggers) })
      setAttachStatus(`Attached to "${columnName}"`)
      setShowAttach(false)
    } catch (err) {
      console.error('Failed to attach script:', err)
      setAttachStatus('Failed to attach')
    }
  }

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
        <div className="relative flex gap-1" ref={dropdownRef}>
          {/* Attach to column button */}
          <button
            type="button"
            onClick={() => { setShowAttach(!showAttach) }}
            title="Attach to column"
            className="rounded p-1 text-text-secondary hover:bg-surface hover:text-text-primary"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
              <path fillRule="evenodd" d="M8.074.945A4.993 4.993 0 0 0 6 5v.032l.002 1.468a.75.75 0 0 1-1.5.003L4.5 5.034C4.5 2.182 6.812.007 9.5.07c2.754.064 4.96 2.393 4.997 5.088l.003 1.375a.75.75 0 0 1-1.5.004l-.003-1.376C12.97 3.218 11.476 1.59 9.558 1.545A3.494 3.494 0 0 0 8.074.945ZM6.5 5v1.5h-1V5a4 4 0 0 1 3.942-4c2.2.051 3.98 1.89 4.055 4.063L13.5 6.5h-1l-.003-1.378C12.44 3.078 10.738 1.574 9.04 1.535A3 3 0 0 0 6.5 5Zm-3 5.5A1.5 1.5 0 0 1 5 9h6a1.5 1.5 0 0 1 1.5 1.5v4A1.5 1.5 0 0 1 11 16H5a1.5 1.5 0 0 1-1.5-1.5v-4Z" clipRule="evenodd" />
            </svg>
          </button>

          {/* Column dropdown */}
          {showAttach && (
            <div className="absolute right-0 top-8 z-50 w-48 rounded-lg border border-border-default bg-surface shadow-lg">
              <div className="border-b border-border-default px-3 py-2">
                <span className="text-[10px] font-medium uppercase tracking-wider text-text-secondary">
                  Attach as on_entry
                </span>
              </div>
              {columns.length === 0 ? (
                <div className="px-3 py-2 text-xs text-text-secondary">No columns found</div>
              ) : (
                <div className="max-h-48 overflow-y-auto py-1">
                  {columns.map((col) => {
                    const triggers = getColumnTriggers(col)
                    const hasEntry = triggers.on_entry && triggers.on_entry.type !== 'none'
                    return (
                      <button
                        key={col.id}
                        type="button"
                        onClick={() => { void handleAttach(col.id, col.name) }}
                        className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
                      >
                        <span className="flex items-center gap-1.5">
                          {col.icon && <span className="text-[11px]">{col.icon}</span>}
                          {col.name}
                        </span>
                        {hasEntry && (
                          <span className="rounded bg-amber-500/10 px-1 py-0.5 text-[9px] text-amber-400">
                            has trigger
                          </span>
                        )}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          )}

          {!script.isBuiltIn && (
            <>
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
            </>
          )}
        </div>
      </div>

      {/* Status message */}
      {attachStatus && (
        <div className={`mt-1.5 text-[11px] font-medium ${attachStatus.startsWith('Failed') ? 'text-error' : 'text-green-400'}`}>
          {attachStatus}
        </div>
      )}

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
