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
import { EmptyState } from '@/components/shared/empty-state'
import { LoadingSpinner } from '@/components/shared/loading-spinner'

// ─── Scripts Tab ────────────────────────────────────────────────────────────

export function ScriptsTab() {
  const [scripts, setScripts] = useState<Script[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Script | null>(null)
  const [creating, setCreating] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null)

  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const loadColumns = useColumnStore((s) => s.load)

  const load = useCallback(async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const s = await ipc.listScripts()
      setScripts(s)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load scripts')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  // Pre-load columns so "attached to" display works without opening the dropdown
  useEffect(() => {
    if (activeWorkspaceId) void loadColumns(activeWorkspaceId)
  }, [activeWorkspaceId, loadColumns])

  const handleDelete = async (id: string) => {
    try {
      await ipc.deleteScript(id)
      setConfirmDelete(null)
      void load()
    } catch (err) {
      console.error('Failed to delete script:', err)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-4 text-sm text-text-secondary">
        <LoadingSpinner size="sm" />
        Loading scripts…
      </div>
    )
  }

  if (loadError) {
    return (
      <div className="rounded-lg border border-error/20 bg-error/5 p-4">
        <p className="mb-2 text-sm text-error">{loadError}</p>
        <button
          type="button"
          onClick={() => { void load() }}
          className="text-xs text-text-secondary underline hover:text-text-primary"
        >
          Retry
        </button>
      </div>
    )
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

        {custom.length === 0 && !creating ? (
          <EmptyState
            icon={
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-full w-full">
                <path fillRule="evenodd" d="M4.25 2A2.25 2.25 0 0 0 2 4.25v11.5A2.25 2.25 0 0 0 4.25 18h11.5A2.25 2.25 0 0 0 18 15.75V4.25A2.25 2.25 0 0 0 15.75 2H4.25ZM6 13.25a.75.75 0 0 0 0 1.5h4a.75.75 0 0 0 0-1.5H6Zm-.75-4a.75.75 0 0 1 .75-.75h8a.75.75 0 0 1 0 1.5H6a.75.75 0 0 1-.75-.75ZM6 6.25a.75.75 0 0 0 0 1.5h3a.75.75 0 0 0 0-1.5H6Z" clipRule="evenodd" />
              </svg>
            }
            title="No custom scripts yet"
            description="Create scripts to automate tasks in your pipeline — run tests, lint, generate PRs, or trigger agents."
            size="sm"
          />
        ) : (
          <div className="space-y-2">
            {custom.map((s) => (
              <ScriptCard
                key={s.id}
                script={s}
                confirmingDelete={confirmDelete === s.id}
                onEdit={() => { setEditing(s) }}
                onDelete={() => { setConfirmDelete(s.id) }}
                onDeleteConfirm={() => { void handleDelete(s.id) }}
                onDeleteCancel={() => { setConfirmDelete(null) }}
              />
            ))}
          </div>
        )}
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
  confirmingDelete,
  onEdit,
  onDelete,
  onDeleteConfirm,
  onDeleteCancel,
}: {
  script: Script
  confirmingDelete?: boolean
  onEdit?: () => void
  onDelete?: () => void
  onDeleteConfirm?: () => void
  onDeleteCancel?: () => void
}) {
  const steps = parseSteps(script.steps)
  const [showAttach, setShowAttach] = useState(false)
  const [attachStatus, setAttachStatus] = useState<string | null>(null)
  const [isAttaching, setIsAttaching] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  const columns = useColumnStore((s) => s.columns)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const updateColumnAsync = useColumnStore((s) => s.updateColumnAsync)
  const loadColumns = useColumnStore((s) => s.load)

  // Load columns when dropdown opens (in case not already loaded)
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
    return () => { document.removeEventListener('mousedown', handleClick) }
  }, [showAttach])

  // Auto-clear status message
  useEffect(() => {
    if (!attachStatus) return
    const timer = setTimeout(() => { setAttachStatus(null) }, 2500)
    return () => { clearTimeout(timer) }
  }, [attachStatus])

  // Columns that use this script as their on_entry trigger
  const attachedColumns = columns.filter((col) => {
    const triggers = getColumnTriggers(col)
    return (
      triggers.on_entry?.type === 'run_script' &&
      triggers.on_entry.script_id === script.id
    )
  })

  const handleAttach = async (columnId: string, columnName: string) => {
    const column = columns.find((c) => c.id === columnId)
    if (!column) return

    const existing = getColumnTriggers(column)
    const hasExistingEntry = existing.on_entry && existing.on_entry.type !== 'none'
    const isAlreadyAttached =
      existing.on_entry?.type === 'run_script' &&
      existing.on_entry.script_id === script.id

    if (isAlreadyAttached) {
      setAttachStatus(`Already attached to "${columnName}"`)
      setShowAttach(false)
      return
    }

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

    setIsAttaching(true)
    try {
      await updateColumnAsync(columnId, { triggers: JSON.stringify(newTriggers) })
      setAttachStatus(`Attached to "${columnName}"`)
      setShowAttach(false)
    } catch (err) {
      console.error('Failed to attach script:', err)
      setAttachStatus('Failed to attach')
    } finally {
      setIsAttaching(false)
    }
  }

  return (
    <div
      className={`rounded-lg border bg-surface/50 p-3 transition-colors ${
        confirmingDelete ? 'border-error/30 bg-error/5' : 'border-border-default'
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        {/* Script info */}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-text-primary">{script.name}</span>
            {script.isBuiltIn && (
              <span className="rounded bg-accent/10 px-1.5 py-0.5 text-xs font-medium text-accent">
                built-in
              </span>
            )}
          </div>
          {script.description && (
            <p className="mt-0.5 text-xs text-text-secondary">{script.description}</p>
          )}
        </div>

        {/* Action buttons or delete confirmation */}
        {confirmingDelete ? (
          <div className="flex shrink-0 items-center gap-1.5">
            <span className="text-xs text-error">Delete?</span>
            <button
              type="button"
              onClick={onDeleteConfirm}
              className="rounded bg-error/10 px-2 py-0.5 text-xs font-medium text-error hover:bg-error/20"
            >
              Yes
            </button>
            <button
              type="button"
              onClick={onDeleteCancel}
              className="rounded border border-border-default px-2 py-0.5 text-xs text-text-secondary hover:text-text-primary"
            >
              No
            </button>
          </div>
        ) : (
          <div className="relative flex shrink-0 items-center gap-0.5" ref={dropdownRef}>
            {/* Attach to column button */}
            <button
              type="button"
              onClick={() => { setShowAttach(!showAttach) }}
              title="Attach as on_entry trigger for a column"
              className="flex items-center gap-1 rounded px-1.5 py-1 text-xs text-text-secondary hover:bg-surface hover:text-text-primary"
            >
              {isAttaching ? (
                <LoadingSpinner size="sm" />
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                  <path d="M8.914 6.025a.75.75 0 0 1 1.06 0 3.75 3.75 0 0 1 0 5.304l-2.004 2.003a3.75 3.75 0 0 1-5.304-5.306l1.5-1.497a.75.75 0 0 1 1.064 1.057l-1.5 1.498a2.25 2.25 0 0 0 3.182 3.183l2.004-2.003a2.25 2.25 0 0 0 0-3.183.75.75 0 0 1 0-1.06Z" />
                  <path d="M7.086 9.975a.75.75 0 0 1-1.06 0 3.75 3.75 0 0 1 0-5.304l2.003-2.003a3.75 3.75 0 0 1 5.306 5.305l-1.5 1.498a.75.75 0 1 1-1.063-1.057l1.5-1.498a2.25 2.25 0 1 0-3.182-3.183L7.086 5.733a2.25 2.25 0 0 0 0 3.182.75.75 0 0 1 0 1.06Z" />
                </svg>
              )}
              <span>Attach</span>
            </button>

            {/* Column picker dropdown */}
            {showAttach && (
              <div className="absolute right-0 top-8 z-50 w-52 rounded-lg border border-border-default bg-surface shadow-lg">
                <div className="border-b border-border-default px-3 py-2">
                  <span className="text-xs font-medium uppercase tracking-wider text-text-secondary">
                    Attach as on_entry trigger
                  </span>
                </div>
                {columns.length === 0 ? (
                  <div className="px-3 py-2 text-xs text-text-secondary">No columns found</div>
                ) : (
                  <div className="max-h-48 overflow-y-auto py-1">
                    {columns.map((col) => {
                      const triggers = getColumnTriggers(col)
                      const isAttachedHere =
                        triggers.on_entry?.type === 'run_script' &&
                        triggers.on_entry.script_id === script.id
                      const hasOtherEntry =
                        !isAttachedHere &&
                        triggers.on_entry &&
                        triggers.on_entry.type !== 'none'
                      return (
                        <button
                          key={col.id}
                          type="button"
                          onClick={() => { void handleAttach(col.id, col.name) }}
                          className="flex w-full items-center justify-between px-3 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
                        >
                          <span className="flex items-center gap-1.5">
                            {col.icon && <span className="text-xs">{col.icon}</span>}
                            {col.name}
                          </span>
                          {isAttachedHere ? (
                            <span className="rounded bg-green-500/10 px-1 py-0.5 text-2xs text-green-400">
                              attached
                            </span>
                          ) : hasOtherEntry ? (
                            <span className="rounded bg-amber-500/10 px-1 py-0.5 text-2xs text-amber-400">
                              has trigger
                            </span>
                          ) : null}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Edit / Delete — custom scripts only */}
            {!script.isBuiltIn && (
              <>
                {onEdit && (
                  <button
                    type="button"
                    onClick={onEdit}
                    title="Edit script"
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
                    title="Delete script"
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
        )}
      </div>

      {/* Attach status feedback */}
      {attachStatus && (
        <p className={`mt-1.5 text-xs font-medium ${attachStatus.startsWith('Failed') ? 'text-error' : 'text-green-400'}`}>
          {attachStatus}
        </p>
      )}

      {/* Steps + attached-to info */}
      <div className="mt-2 flex items-end justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {steps.length > 0 ? (
            steps.map((step, i) => (
              <span
                key={i}
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium ${STEP_TYPE_COLORS[step.type] ?? 'bg-surface text-text-secondary'}`}
              >
                {step.name || step.type}
              </span>
            ))
          ) : (
            <span className="text-xs italic text-text-secondary/50">no steps</span>
          )}
        </div>

        {/* Show which columns have this script attached */}
        {attachedColumns.length > 0 && (
          <div className="flex shrink-0 items-center gap-1 text-xs text-text-secondary">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12" fill="currentColor" className="h-2.5 w-2.5 text-accent/60">
              <path d="M5.457 3.525a.563.563 0 0 1 .795 0 2.813 2.813 0 0 1 0 3.978l-1.5 1.5a2.813 2.813 0 1 1-3.978-3.978L1.9 3.9A.562.562 0 0 1 2.697 4.7l-.127.125a1.688 1.688 0 1 0 2.387 2.387l1.5-1.5a1.688 1.688 0 0 0 0-2.387.563.563 0 0 1 0-.8Z" />
              <path d="M6.543 8.475a.563.563 0 0 1-.795 0 2.813 2.813 0 0 1 0-3.978l1.5-1.5a2.813 2.813 0 1 1 3.978 3.978l-.126.125a.562.562 0 0 1-.796-.796l.126-.125a1.688 1.688 0 1 0-2.387-2.387l-1.5 1.5a1.688 1.688 0 0 0 0 2.387.563.563 0 0 1 0 .796Z" />
            </svg>
            <span>{attachedColumns.map((c) => c.name).join(', ')}</span>
          </div>
        )}
      </div>
    </div>
  )
}
