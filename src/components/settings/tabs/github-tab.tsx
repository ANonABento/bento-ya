import { useState, useCallback, useMemo, useEffect } from 'react'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useColumnStore } from '@/stores/column-store'
import { SettingSection, SettingRow } from '@/components/shared/setting-components'
import { parseWorkspaceConfig } from '@/types'
import type { WorkspaceConfig } from '@/types'
import * as ipc from '@/lib/ipc'

export function GithubTab() {
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const updateWorkspace = useWorkspaceStore((s) => s.update)
  const columns = useColumnStore((s) => s.columns)

  const workspace = workspaces.find((w) => w.id === activeWorkspaceId)

  const config = useMemo<WorkspaceConfig>(
    () => parseWorkspaceConfig(workspace?.config ?? '{}'),
    [workspace?.config],
  )

  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [isSyncing, setIsSyncing] = useState(false)
  const [lastSyncedAt, setLastSyncedAt] = useState<string | null>(null)

  // Load last-synced timestamp on mount
  useEffect(() => {
    if (!activeWorkspaceId) return
    ipc.getGithubSyncState(activeWorkspaceId)
      .then((s) => { setLastSyncedAt(s?.lastSyncedAt ?? null) })
      .catch(() => { /* not yet synced */ })
  }, [activeWorkspaceId])

  const updateConfig = useCallback(async (patch: Partial<WorkspaceConfig>) => {
    if (!workspace) return
    const merged = { ...config, ...patch }
    try {
      const updated = await ipc.updateWorkspaceConfig(workspace.id, JSON.stringify(merged))
      await updateWorkspace(workspace.id, { config: updated.config })
      setMessage({ type: 'success', text: 'GitHub settings saved' })
    } catch {
      setMessage({ type: 'error', text: 'Failed to save GitHub settings' })
    }
  }, [workspace, config, updateWorkspace])

  const handleSyncNow = async () => {
    if (!workspace) return
    setIsSyncing(true)
    setMessage(null)
    try {
      const result = await ipc.syncGithubIssuesNow(workspace.id)
      setLastSyncedAt(new Date().toISOString())
      setMessage({
        type: 'success',
        text: `Synced: ${result.tasksCreated} task(s) created, ${result.issuesFetched} issue(s) fetched`,
      })
    } catch (err) {
      setMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Sync failed',
      })
    } finally {
      setIsSyncing(false)
    }
  }

  const columnOptions = useMemo(
    () => [{ value: '', label: 'None' }, ...columns.map((c) => ({ value: c.id, label: c.name }))],
    [columns],
  )

  if (!workspace) {
    return (
      <div className="rounded-lg border border-dashed border-border-default p-6 text-center">
        <p className="text-sm text-text-secondary">No workspace selected</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
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

      <SettingSection title="GitHub Issues Sync" description="Pull open GitHub issues as tasks and push status back when tasks complete">
        <div className="space-y-4">
          <SettingRow label="Enable Sync" description="Automatically sync every 5 minutes">
            <button
              type="button"
              role="switch"
              aria-checked={config.githubSyncEnabled ?? false}
              onClick={() => { void updateConfig({ githubSyncEnabled: !(config.githubSyncEnabled ?? false) }) }}
              className={`relative inline-flex h-6 w-11 shrink-0 rounded-full border-2 border-transparent transition-colors focus:outline-none focus:ring-2 focus:ring-accent/20 ${
                (config.githubSyncEnabled ?? false) ? 'bg-accent' : 'bg-border-default'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                  (config.githubSyncEnabled ?? false) ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </SettingRow>

          <SettingRow label="Repository" description='GitHub repo to sync (e.g. "owner/repo")'>
            <input
              type="text"
              value={config.githubRepo ?? ''}
              onChange={(e) => { void updateConfig({ githubRepo: e.target.value }) }}
              placeholder="owner/repo"
              className="w-48 rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-text-primary transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </SettingRow>

          <SettingRow label="Label Filter" description="Only sync issues with this label (leave blank for all)">
            <input
              type="text"
              value={config.githubLabelFilter ?? ''}
              onChange={(e) => { void updateConfig({ githubLabelFilter: e.target.value }) }}
              placeholder="e.g. bento"
              className="w-48 rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-text-primary transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </SettingRow>
        </div>
      </SettingSection>

      <SettingSection title="Column Mapping" description="Map board columns to GitHub actions">
        <div className="space-y-4">
          <SettingRow label="Inbox Column" description="New issues are created in this column">
            <select
              value={config.githubInboxColumnId ?? ''}
              onChange={(e) => { void updateConfig({ githubInboxColumnId: e.target.value }) }}
              className="rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-text-primary transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            >
              {columnOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </SettingRow>

          <SettingRow label="Done Column" description="Tasks here trigger a 'resolved' comment on the linked issue">
            <select
              value={config.githubDoneColumnId ?? ''}
              onChange={(e) => { void updateConfig({ githubDoneColumnId: e.target.value }) }}
              className="rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-text-primary transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            >
              {columnOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </SettingRow>

          <SettingRow label="PR Column" description="Tasks here with a PR URL post a link comment on the issue">
            <select
              value={config.githubPrColumnId ?? ''}
              onChange={(e) => { void updateConfig({ githubPrColumnId: e.target.value }) }}
              className="rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-text-primary transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            >
              {columnOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </SettingRow>
        </div>
      </SettingSection>

      <SettingSection title="Manual Sync">
        <div className="flex items-center gap-4">
          <button
            onClick={() => { void handleSyncNow() }}
            disabled={isSyncing || !config.githubRepo}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
          >
            {isSyncing ? 'Syncing...' : 'Sync Now'}
          </button>
          {lastSyncedAt && (
            <span className="text-xs text-text-secondary">
              Last synced: {new Date(lastSyncedAt).toLocaleString()}
            </span>
          )}
          {!config.githubRepo && (
            <span className="text-xs text-text-secondary">Set a repository above to enable sync</span>
          )}
        </div>
      </SettingSection>
    </div>
  )
}
