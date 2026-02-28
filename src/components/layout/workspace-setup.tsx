import { useState, useCallback } from 'react'
import { useWorkspaceStore } from '@/stores/workspace-store'

export function WorkspaceSetup() {
  const [name, setName] = useState('')
  const [repoPath, setRepoPath] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const addWorkspace = useWorkspaceStore((s) => s.add)
  const setActive = useWorkspaceStore((s) => s.setActive)

  const handleCreate = useCallback(async () => {
    const trimmedName = name.trim() || 'My Workspace'
    const trimmedPath = repoPath.trim()

    if (!trimmedPath) {
      setError('Please enter a repository path')
      return
    }

    setCreating(true)
    setError(null)

    try {
      await addWorkspace(trimmedName, trimmedPath)
      // The workspace store will update, and App will re-render showing the board
      const workspaces = useWorkspaceStore.getState().workspaces
      const created = workspaces[workspaces.length - 1]
      if (created) {
        setActive(created.id)
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      if (message.includes('repo') || message.includes('git')) {
        setError('Invalid repo path — make sure it points to a git repository')
      } else {
        setError(message)
      }
    } finally {
      setCreating(false)
    }
  }, [name, repoPath, addWorkspace, setActive])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !creating) {
        void handleCreate()
      }
    },
    [handleCreate, creating],
  )

  return (
    <div className="flex h-full items-center justify-center">
      <div className="w-full max-w-md space-y-4 px-6">
        <div className="text-center">
          <h2 className="text-lg font-medium text-text-primary">
            Create a workspace
          </h2>
          <p className="mt-1 text-sm text-text-secondary">
            Point to a git repo to get started
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <label htmlFor="ws-name" className="mb-1 block text-xs text-text-secondary">
              Name
            </label>
            <input
              id="ws-name"
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value) }}
              onKeyDown={handleKeyDown}
              placeholder="My Workspace"
              className="w-full rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>

          <div>
            <label htmlFor="ws-path" className="mb-1 block text-xs text-text-secondary">
              Repository path
            </label>
            <input
              id="ws-path"
              type="text"
              value={repoPath}
              onChange={(e) => {
                setRepoPath(e.target.value)
                setError(null)
              }}
              onKeyDown={handleKeyDown}
              placeholder="/Users/you/project"
              className="w-full rounded-lg border border-border-default bg-surface px-3 py-2 font-mono text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>
        </div>

        {error && (
          <p className="text-xs text-error">{error}</p>
        )}

        <button
          type="button"
          onClick={() => { void handleCreate() }}
          disabled={creating}
          className="w-full rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {creating ? 'Creating...' : 'Create workspace'}
        </button>
      </div>
    </div>
  )
}
