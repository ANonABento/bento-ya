import { useState, useCallback, useMemo } from 'react'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useColumnStore } from '@/stores/column-store'
import { useTaskStore } from '@/stores/task-store'
import { SettingSection, SettingRow, SettingSlider } from '@/components/shared/setting-components'
import { Toggle } from '@/components/shared/toggle'
import { PathPicker } from '@/components/shared/path-picker'
import { parseWorkspaceConfig } from '@/types'
import type { WorkspaceConfig } from '@/types'
import * as ipc from '@/lib/ipc'

const MODEL_OPTIONS = [
  { value: '', label: 'Inherit (use trigger / global default)' },
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
] as const

const CLI_OPTIONS = [
  { value: '', label: 'Inherit (use trigger / global default)' },
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
] as const

const DEFAULT_BASE_BRANCH = 'main'

export function WorkspaceTab() {
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const setActive = useWorkspaceStore((s) => s.setActive)
  const removeWorkspace = useWorkspaceStore((s) => s.remove)
  const updateWorkspace = useWorkspaceStore((s) => s.update)
  const loadColumns = useColumnStore((s) => s.load)
  const loadTasks = useTaskStore((s) => s.load)

  const workspace = workspaces.find((w) => w.id === activeWorkspaceId)

  const config = useMemo<WorkspaceConfig>(
    () => parseWorkspaceConfig(workspace?.config ?? '{}'),
    [workspace?.config],
  )

  const [isDeleting, setIsDeleting] = useState(false)
  const [isSwitching, setIsSwitching] = useState<string | null>(null)
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [confirmName, setConfirmName] = useState('')
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const updateConfig = useCallback(async (patch: Partial<WorkspaceConfig>) => {
    if (!workspace) return
    const merged = { ...config, ...patch }
    if (!merged.defaultModel) delete merged.defaultModel
    if (!merged.defaultAgentCli) delete merged.defaultAgentCli
    if (!merged.defaultBaseBranch || merged.defaultBaseBranch === DEFAULT_BASE_BRANCH) {
      delete merged.defaultBaseBranch
    }
    try {
      const updated = await ipc.updateWorkspaceConfig(workspace.id, JSON.stringify(merged))
      await updateWorkspace(workspace.id, { config: updated.config })
      setMessage({ type: 'success', text: 'Workspace settings updated' })
    } catch {
      setMessage({ type: 'error', text: 'Failed to update workspace settings' })
    }
  }, [workspace, config, updateWorkspace])

  const [baseBranchDraft, setBaseBranchDraft] = useState<string | null>(null)
  const baseBranchValue = baseBranchDraft ?? config.defaultBaseBranch ?? DEFAULT_BASE_BRANCH

  const commitBaseBranch = useCallback(() => {
    if (baseBranchDraft == null) return
    const trimmed = baseBranchDraft.trim()
    setBaseBranchDraft(null)
    if (!trimmed) {
      setMessage({ type: 'error', text: 'Default base branch cannot be empty' })
      return
    }
    const next = trimmed === DEFAULT_BASE_BRANCH ? undefined : trimmed
    void updateConfig({ defaultBaseBranch: next })
  }, [baseBranchDraft, updateConfig])

  const handleRepoPathChange = useCallback(async (path: string) => {
    if (!workspace) return
    try {
      await updateWorkspace(workspace.id, { repoPath: path })
      setMessage({ type: 'success', text: 'Repository path updated' })
    } catch {
      setMessage({ type: 'error', text: 'Failed to update repo path' })
    }
  }, [workspace, updateWorkspace])

  const handleSwitchWorkspace = async (workspaceId: string) => {
    if (workspaceId === activeWorkspaceId) return
    setIsSwitching(workspaceId)
    setMessage(null)
    try {
      setActive(workspaceId)
      await loadColumns(workspaceId)
      await loadTasks(workspaceId)
      setMessage({ type: 'success', text: 'Switched workspace' })
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to switch workspace' })
    } finally {
      setIsSwitching(null)
    }
  }

  const handleDeleteWorkspace = async () => {
    if (!workspace) return
    setIsDeleting(true)
    setMessage(null)
    try {
      await removeWorkspace(workspace.id)
      setMessage({ type: 'success', text: 'Workspace deleted' })
      setShowDeleteConfirm(false)
      setConfirmName('')
      const remaining = workspaces.filter((w) => w.id !== workspace.id)
      const nextWorkspace = remaining[0]
      if (nextWorkspace) {
        setActive(nextWorkspace.id)
        await loadColumns(nextWorkspace.id)
        await loadTasks(nextWorkspace.id)
      }
    } catch (err) {
      setMessage({ type: 'error', text: err instanceof Error ? err.message : 'Failed to delete workspace' })
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="space-y-8">
      {message && (
        <div
          className={`rounded-lg p-3 text-sm ${
            message.type === 'success'
              ? 'border border-green-500/20 bg-green-500/10 text-green-500'
              : 'border border-red-500/20 bg-red-500/10 text-red-500'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* ── Current workspace ─────────────────────────────────── */}
      <SettingSection title="Current workspace">
        {workspace ? (
          <div className="space-y-3 rounded-lg border border-accent/40 bg-accent/5 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-text-secondary/70">Name</div>
                <p className="truncate text-sm font-semibold text-text-primary">{workspace.name}</p>
              </div>
              <span className="shrink-0 rounded-full bg-accent/20 px-2 py-0.5 text-xs font-medium text-accent">
                Active
              </span>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wider text-text-secondary/70">Repository path</div>
              <div className="mt-1">
                <PathPicker
                  value={workspace.repoPath}
                  onChange={(path) => { void handleRepoPathChange(path) }}
                  readOnly
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-text-secondary/80">
              <span>Created {new Date(workspace.createdAt).toLocaleDateString()}</span>
              <span>Updated {new Date(workspace.updatedAt).toLocaleDateString()}</span>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border-default p-6 text-center">
            <p className="text-sm text-text-secondary">No workspace selected</p>
            <p className="mt-1 text-xs text-text-secondary/70">Create one from the tab bar at the top.</p>
          </div>
        )}
      </SettingSection>

      {/* ── Agent defaults ────────────────────────────────────── */}
      {workspace && (
        <SettingSection
          title="Agent defaults"
          description="Fallbacks for this workspace when a column trigger or task doesn't specify its own value. Per-trigger and per-task overrides take precedence."
          border
        >
          <div className="space-y-5">
            <SettingRow
              label="Default model"
              description="Used when a trigger or task doesn't pick a model."
            >
              <select
                value={config.defaultModel ?? ''}
                onChange={(e) => { void updateConfig({ defaultModel: e.target.value }) }}
                className="min-w-48 rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-text-primary transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              >
                {MODEL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </SettingRow>

            <SettingRow
              label="Default agent CLI"
              description="The CLI tool that spawns agent sessions."
            >
              <select
                value={config.defaultAgentCli ?? ''}
                onChange={(e) => { void updateConfig({ defaultAgentCli: e.target.value }) }}
                className="min-w-48 rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-text-primary transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              >
                {CLI_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </SettingRow>

            <SettingRow
              label="Default base branch"
              description="Branch new task branches are created from."
            >
              <input
                type="text"
                value={baseBranchValue}
                onChange={(e) => { setBaseBranchDraft(e.target.value) }}
                onBlur={commitBaseBranch}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitBaseBranch()
                  } else if (e.key === 'Escape') {
                    setBaseBranchDraft(null)
                  }
                }}
                placeholder={DEFAULT_BASE_BRANCH}
                spellCheck={false}
                className="min-w-40 rounded-lg border border-border-default bg-surface px-3 py-2 text-sm font-mono text-text-primary transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
            </SettingRow>
          </div>
        </SettingSection>
      )}

      {/* ── Concurrency & lifecycle ───────────────────────────── */}
      {workspace && (
        <SettingSection
          title="Concurrency & lifecycle"
          description="How many agents run in parallel in this workspace, and how their sessions are managed."
          border
        >
          <div className="space-y-5">
            <SettingRow
              label="Max concurrent agents (this workspace)"
              description="Cap for this workspace only. Lower than the global limit takes effect."
              vertical
            >
              <SettingSlider
                value={config.maxConcurrentAgents ?? 5}
                onChange={(v) => { void updateConfig({ maxConcurrentAgents: v }) }}
                min={1}
                max={10}
              />
            </SettingRow>

            <SettingRow
              label="Persistent agent sessions"
              description="Keep per-task tmux sessions alive across triggers, panel reopens, and app restarts. Disable to spawn a fresh shell each time (uses less memory but loses session history)."
            >
              <Toggle
                checked={config.persistentAgentLifecycle ?? true}
                onChange={(v) => { void updateConfig({ persistentAgentLifecycle: v }) }}
                size="md"
                aria-label="Persistent agent sessions"
              />
            </SettingRow>
          </div>
        </SettingSection>
      )}

      {/* ── Pipeline behavior ─────────────────────────────────── */}
      {workspace && (
        <SettingSection
          title="Pipeline behavior"
          description="How tasks advance through columns and get cleaned up."
          border
        >
          <div className="space-y-5">
            <SettingRow
              label="Auto-advance to next column"
              description="Move tasks to the next column automatically when exit criteria are met (e.g. agent_complete, script_success)."
            >
              <Toggle
                checked={config.autoAdvance ?? true}
                onChange={(v) => { void updateConfig({ autoAdvance: v }) }}
                size="md"
                aria-label="Auto-Advance"
              />
            </SettingRow>

            <SettingRow
              label="Auto-archive Done"
              description="Tasks that sit in Done past the grace period are archived automatically."
            >
              <Toggle
                checked={config.autoArchiveDone ?? true}
                onChange={(v) => { void updateConfig({ autoArchiveDone: v }) }}
                size="md"
                aria-label="Auto-Archive Done"
              />
            </SettingRow>

            <SettingRow
              label="Archive grace period (minutes)"
              description="How long a task waits in Done before auto-archive."
              vertical
            >
              <div className={(config.autoArchiveDone ?? true) ? '' : 'pointer-events-none opacity-50'}>
                <SettingSlider
                  value={config.autoArchiveGraceMinutes ?? 5}
                  onChange={(v) => { void updateConfig({ autoArchiveGraceMinutes: v }) }}
                  min={1}
                  max={60}
                  formatValue={(v) => `${String(v)}m`}
                />
              </div>
            </SettingRow>
          </div>
        </SettingSection>
      )}

      {/* ── Switch workspace ──────────────────────────────────── */}
      {workspaces.length > 1 && (
        <SettingSection title="Switch workspace" border>
          <div className="space-y-2">
            {workspaces
              .filter((ws) => ws.id !== activeWorkspaceId)
              .map((ws) => (
                <button
                  key={ws.id}
                  onClick={() => { void handleSwitchWorkspace(ws.id) }}
                  disabled={isSwitching === ws.id}
                  className="flex w-full items-center justify-between gap-3 rounded-lg border border-border-default p-3 text-left transition-colors hover:border-accent/50 hover:bg-accent/5 disabled:opacity-50"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text-primary">{ws.name}</p>
                    <p className="truncate font-mono text-xs text-text-secondary">{ws.repoPath}</p>
                  </div>
                  <span className="flex shrink-0 items-center gap-1 text-xs text-accent">
                    {isSwitching === ws.id ? (
                      <>
                        <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Switching...
                      </>
                    ) : (
                      <>
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                          <path fillRule="evenodd" d="M3 4.25A2.25 2.25 0 0 1 5.25 2h5.5A2.25 2.25 0 0 1 13 4.25v2a.75.75 0 0 1-1.5 0v-2a.75.75 0 0 0-.75-.75h-5.5a.75.75 0 0 0-.75.75v11.5c0 .414.336.75.75.75h5.5a.75.75 0 0 0 .75-.75v-2a.75.75 0 0 1 1.5 0v2A2.25 2.25 0 0 1 10.75 18h-5.5A2.25 2.25 0 0 1 3 15.75V4.25Z" clipRule="evenodd" />
                          <path fillRule="evenodd" d="M19 10a.75.75 0 0 0-.75-.75H8.704l1.048-.943a.75.75 0 1 0-1.004-1.114l-2.5 2.25a.75.75 0 0 0 0 1.114l2.5 2.25a.75.75 0 1 0 1.004-1.114l-1.048-.943h9.546A.75.75 0 0 0 19 10Z" clipRule="evenodd" />
                        </svg>
                        Switch
                      </>
                    )}
                  </span>
                </button>
              ))}
          </div>
        </SettingSection>
      )}

      {/* ── Danger zone ───────────────────────────────────────── */}
      {workspace && (
        <SettingSection title="Danger zone" border>
          {!showDeleteConfirm ? (
            <div className="rounded-lg border border-red-500/30 bg-red-500/5 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-text-primary">Delete this workspace</p>
                  <p className="mt-0.5 text-xs text-text-secondary">
                    Permanently removes all columns, tasks, agent sessions, and history for{' '}
                    <span className="font-mono text-text-primary">{workspace.name}</span>.
                  </p>
                </div>
                <button
                  onClick={() => { setShowDeleteConfirm(true) }}
                  className="shrink-0 rounded-lg border border-red-500/50 px-3 py-1.5 text-sm font-medium text-red-400 transition-colors hover:bg-red-500/10"
                >
                  Delete…
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3 rounded-lg border border-red-500/50 bg-red-500/10 p-4">
              <div>
                <p className="text-sm font-medium text-text-primary">
                  This cannot be undone.
                </p>
                <p className="mt-1 text-xs text-text-secondary">
                  Type the workspace name to confirm: <span className="font-mono text-text-primary">{workspace.name}</span>
                </p>
              </div>
              <input
                type="text"
                value={confirmName}
                onChange={(e) => { setConfirmName(e.target.value) }}
                placeholder={workspace.name}
                className="w-full rounded-lg border border-red-500/40 bg-bg px-3 py-2 text-sm font-mono text-text-primary focus:border-red-400 focus:outline-none"
                autoFocus
              />
              <div className="flex gap-2">
                <button
                  onClick={() => { void handleDeleteWorkspace() }}
                  disabled={isDeleting || confirmName !== workspace.name}
                  className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isDeleting ? 'Deleting...' : 'Delete permanently'}
                </button>
                <button
                  onClick={() => {
                    setShowDeleteConfirm(false)
                    setConfirmName('')
                  }}
                  className="rounded-lg border border-border-default px-4 py-2 text-sm text-text-secondary transition-colors hover:bg-surface"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </SettingSection>
      )}
    </div>
  )
}
