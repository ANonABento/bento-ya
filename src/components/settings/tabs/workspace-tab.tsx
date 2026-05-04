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
  { value: '', label: 'None (use trigger default)' },
  { value: 'opus', label: 'Opus' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
] as const

const CLI_OPTIONS = [
  { value: '', label: 'None (use trigger default)' },
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
] as const

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
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  const updateConfig = useCallback(async (patch: Partial<WorkspaceConfig>) => {
    if (!workspace) return
    const merged = { ...config, ...patch }
    // Remove keys set to empty/default values
    if (!merged.defaultModel) delete merged.defaultModel
    if (!merged.defaultAgentCli) delete merged.defaultAgentCli
    try {
      const updated = await ipc.updateWorkspaceConfig(workspace.id, JSON.stringify(merged))
      await updateWorkspace(workspace.id, { config: updated.config })
      setMessage({ type: 'success', text: 'Workspace settings updated' })
    } catch {
      setMessage({ type: 'error', text: 'Failed to update workspace settings' })
    }
  }, [workspace, config, updateWorkspace])

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
      // Load the next workspace if available
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
    <div className="space-y-6">
      {/* Status Message - at top for visibility */}
      {message && (
        <div
          className={`rounded-lg p-3 text-sm ${
            message.type === 'success'
              ? 'bg-green-500/10 text-green-500 border border-green-500/20'
              : 'bg-red-500/10 text-red-500 border border-red-500/20'
          }`}
        >
          {message.text}
        </div>
      )}

      {/* Current Workspace Info */}
      <SettingSection title="Current Workspace">
        {workspace ? (
          <div className="rounded-lg border border-accent bg-accent/5 p-4 space-y-3">
            <div className="flex items-start justify-between">
              <div>
                <label className="text-xs font-medium text-text-secondary">Name</label>
                <p className="text-sm font-medium text-text-primary">{workspace.name}</p>
              </div>
              <span className="rounded-full bg-accent/20 px-2 py-0.5 text-xs font-medium text-accent">
                Active
              </span>
            </div>
            <div>
              <label className="text-xs font-medium text-text-secondary">Repository Path</label>
              <div className="mt-1">
                <PathPicker
                  value={workspace.repoPath}
                  onChange={(path) => { void handleRepoPathChange(path) }}
                  readOnly
                />
              </div>
            </div>
            <div className="flex gap-4 text-xs text-text-secondary">
              <span>Created: {new Date(workspace.createdAt).toLocaleDateString()}</span>
              <span>Updated: {new Date(workspace.updatedAt).toLocaleDateString()}</span>
            </div>
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border-default p-6 text-center">
            <p className="text-sm text-text-secondary">No workspace selected</p>
            <p className="mt-1 text-xs text-text-secondary/70">Create a new workspace from the tab bar</p>
          </div>
        )}
      </SettingSection>

      {/* Pipeline Defaults */}
      {workspace && (
        <SettingSection title="Pipeline Defaults" description="Fallback settings when column triggers don't specify values">
          <div className="space-y-4">
            <SettingRow label="Default Model" description="AI model used when trigger and task don't specify one">
              <select
                value={config.defaultModel ?? ''}
                onChange={(e) => { void updateConfig({ defaultModel: e.target.value }) }}
                className="rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-text-primary transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              >
                {MODEL_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </SettingRow>

            <SettingRow label="Default Agent CLI" description="CLI tool used when trigger doesn't specify one">
              <select
                value={config.defaultAgentCli ?? ''}
                onChange={(e) => { void updateConfig({ defaultAgentCli: e.target.value }) }}
                className="rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-text-primary transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              >
                {CLI_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </SettingRow>

            <SettingRow label="Max Concurrent Agents" description="Maximum number of agents running simultaneously">
              <SettingSlider
                value={config.maxConcurrentAgents ?? 5}
                onChange={(v) => { void updateConfig({ maxConcurrentAgents: v }) }}
                min={1}
                max={10}
              />
            </SettingRow>

            <SettingRow label="Auto-Advance" description="Automatically move tasks to next column when exit criteria are met">
              <Toggle
                checked={config.autoAdvance ?? true}
                onChange={(v) => { void updateConfig({ autoAdvance: v }) }}
                size="md"
              />
            </SettingRow>

            <SettingRow
              label="Auto-Archive Done"
              description="Automatically archive tasks that sit in Done past the grace period"
            >
              <Toggle
                checked={config.autoArchiveDone ?? true}
                onChange={(v) => { void updateConfig({ autoArchiveDone: v }) }}
                size="md"
              />
            </SettingRow>

            {(config.autoArchiveDone ?? true) && (
              <SettingRow
                label="Archive Grace Period"
                description="Minutes a Done task waits before auto-archiving"
              >
                <SettingSlider
                  value={config.autoArchiveGraceMinutes ?? 5}
                  onChange={(v) => { void updateConfig({ autoArchiveGraceMinutes: v }) }}
                  min={1}
                  max={60}
                />
              </SettingRow>
            )}
          </div>
        </SettingSection>
      )}

      {/* Switch Workspace */}
      {workspaces.length > 1 && (
        <SettingSection title="Switch Workspace">
          <div className="space-y-2">
            {workspaces
              .filter((ws) => ws.id !== activeWorkspaceId)
              .map((ws) => (
                <button
                  key={ws.id}
                  onClick={() => { void handleSwitchWorkspace(ws.id) }}
                  disabled={isSwitching === ws.id}
                  className="flex w-full items-center justify-between rounded-lg border border-border-default p-3 text-left transition-colors hover:border-accent/50 hover:bg-accent/5 disabled:opacity-50"
                >
                  <div>
                    <p className="text-sm font-medium text-text-primary">{ws.name}</p>
                    <p className="text-xs text-text-secondary font-mono">{ws.repoPath}</p>
                  </div>
                  <span className="flex items-center gap-1 text-xs text-accent">
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

      {/* Delete Workspace */}
      {workspace && (
        <SettingSection title="Danger Zone" border>
          {!showDeleteConfirm ? (
            <button
              onClick={() => { setShowDeleteConfirm(true) }}
              className="rounded-lg border border-red-500/50 px-4 py-2 text-sm font-medium text-red-500 transition-colors hover:bg-red-500/10"
            >
              Delete "{workspace.name}"
            </button>
          ) : (
            <div className="rounded-lg border border-red-500/50 bg-red-500/5 p-4 space-y-3">
              <p className="text-sm text-text-primary">
                Are you sure you want to delete <strong>{workspace.name}</strong>?
              </p>
              <p className="text-xs text-text-secondary">
                This will permanently delete all columns and tasks in this workspace.
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => { void handleDeleteWorkspace() }}
                  disabled={isDeleting}
                  className="rounded-lg bg-red-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-600 disabled:opacity-50"
                >
                  {isDeleting ? 'Deleting...' : 'Yes, Delete'}
                </button>
                <button
                  onClick={() => { setShowDeleteConfirm(false) }}
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
