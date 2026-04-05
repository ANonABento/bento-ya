import { useState, useEffect, useCallback } from 'react'
import { motion } from 'motion/react'
import { open } from '@tauri-apps/plugin-dialog'
import { getCurrentBranch, detectClis } from '@/lib/ipc'
import type { DetectedCli } from '@/lib/ipc/cli'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { BUILT_IN_TEMPLATES } from '@/types/templates'

type OnboardingWizardProps = {
  onComplete: () => void
}

type GitStatus = 'valid' | 'invalid' | 'empty' | 'checking' | null

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [name, setName] = useState('')
  const [repoPath, setRepoPath] = useState('')
  const [template, setTemplate] = useState('standard')
  const [selectedClis, setSelectedClis] = useState<Set<string>>(new Set())
  const [isCreating, setIsCreating] = useState(false)
  const [gitStatus, setGitStatus] = useState<GitStatus>(null)
  const [error, setError] = useState<string | null>(null)
  const [detectedClis, setDetectedClis] = useState<DetectedCli[]>([])

  const addWorkspace = useWorkspaceStore((s) => s.add)
  const setActive = useWorkspaceStore((s) => s.setActive)

  // Detect CLIs on mount
  useEffect(() => {
    detectClis()
      .then((clis) => {
        const available = clis.filter((c) => c.isAvailable)
        setDetectedClis(available)
        if (available.length > 0) {
          setSelectedClis(new Set(available.map(c => c.id)))
        }
      })
      .catch(() => {
        // CLI detection is non-critical
      })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Validate git repo when path changes
  useEffect(() => {
    const trimmed = repoPath.trim()
    if (!trimmed) {
      setGitStatus(null)
      return
    }

    setGitStatus('checking')
    const timeout = setTimeout(() => {
      getCurrentBranch(trimmed)
        .then(() => {
          setGitStatus('valid')
        })
        .catch(() => {
          setGitStatus('invalid')
        })
    }, 300)

    return () => { clearTimeout(timeout) }
  }, [repoPath])

  const handleBrowse = useCallback(async () => {
    try {
      const selected = await open({ directory: true, multiple: false })
      if (selected) {
        setRepoPath(selected)
        setError(null)
      }
    } catch {
      // User cancelled
    }
  }, [])

  const handleCreate = useCallback(async () => {
    const trimmedName = name.trim() || 'My Project'
    const trimmedPath = repoPath.trim()

    if (!trimmedPath) {
      setError('Please select a repository path')
      return
    }

    setIsCreating(true)
    setError(null)

    try {
      await addWorkspace(trimmedName, trimmedPath)
      const workspaces = useWorkspaceStore.getState().workspaces
      const created = workspaces[workspaces.length - 1]
      if (created) {
        setActive(created.id)
      }
      onComplete()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
    } finally {
      setIsCreating(false)
    }
  }, [name, repoPath, addWorkspace, setActive, onComplete])

  const canCreate = repoPath.trim().length > 0 && !isCreating

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-bg p-4"
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-lg rounded-2xl border border-border-default bg-surface shadow-2xl p-8"
      >
        {/* Title */}
        <div className="mb-6 text-center">
          <h2 className="text-xl font-semibold text-text-primary">Welcome to Bento-ya</h2>
          <p className="mt-1 text-sm text-text-secondary">
            Set up your first workspace to get started
          </p>
        </div>

        <div className="space-y-4">
          {/* Name input */}
          <div>
            <label htmlFor="onboard-name" className="mb-1 block text-xs font-medium text-text-secondary">
              Workspace Name
            </label>
            <input
              id="onboard-name"
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value) }}
              placeholder="My Project"
              className="w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>

          {/* Repository path */}
          <div>
            <label htmlFor="onboard-path" className="mb-1 block text-xs font-medium text-text-secondary">
              Repository Path
            </label>
            <div className="flex gap-2">
              <input
                id="onboard-path"
                type="text"
                value={repoPath}
                onChange={(e) => {
                  setRepoPath(e.target.value)
                  setError(null)
                }}
                placeholder="/Users/you/project"
                className="flex-1 rounded-lg border border-border-default bg-bg px-3 py-2 font-mono text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              />
              <button
                type="button"
                onClick={() => { void handleBrowse() }}
                className="shrink-0 rounded-lg border border-border-default bg-bg px-3 py-2 text-sm font-medium text-text-primary transition-colors hover:bg-surface-hover"
              >
                Browse
              </button>
            </div>
            {/* Git status */}
            {gitStatus === 'checking' && (
              <p className="mt-1 text-xs text-text-secondary">Checking repository...</p>
            )}
            {gitStatus === 'valid' && (
              <p className="mt-1 text-xs text-success">Valid git repository</p>
            )}
            {gitStatus === 'invalid' && (
              <div className="mt-1">
                <p className="text-xs text-error">Not a git repository</p>
                <p className="text-xs text-text-secondary">
                  The workspace will be created without git integration.
                </p>
              </div>
            )}
          </div>

          {/* Template selector */}
          <div>
            <label htmlFor="onboard-template" className="mb-1 block text-xs font-medium text-text-secondary">
              Template
            </label>
            <select
              id="onboard-template"
              value={template}
              onChange={(e) => { setTemplate(e.target.value) }}
              className="w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            >
              {BUILT_IN_TEMPLATES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.columns.length} columns)
                </option>
              ))}
            </select>
          </div>

          {/* Agent selector */}
          <div>
            <label htmlFor="onboard-cli" className="mb-1 block text-xs font-medium text-text-secondary">
              Agent
            </label>
            {detectedClis.length > 0 ? (
              <div className="space-y-1.5">
                {detectedClis.map((cli) => (
                  <label
                    key={cli.id}
                    className="flex items-center gap-3 rounded-lg border border-border-default bg-bg px-3 py-2 cursor-pointer hover:bg-surface-hover transition-colors"
                  >
                    <input
                      type="checkbox"
                      checked={selectedClis.has(cli.id)}
                      onChange={() => {
                        setSelectedClis(prev => {
                          const next = new Set(prev)
                          if (next.has(cli.id)) { next.delete(cli.id) } else { next.add(cli.id) }
                          return next
                        })
                      }}
                      className="rounded border-border-default accent-accent"
                    />
                    <div className="flex-1">
                      <span className="text-sm text-text-primary">{cli.name}</span>
                      {cli.version && <span className="ml-2 text-xs text-text-secondary">{cli.version}</span>}
                    </div>
                  </label>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-secondary">
                No agent CLIs detected. You can configure one later in Settings.
              </p>
            )}
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-error">{error}</p>
          )}

          {/* Create button */}
          <button
            type="button"
            onClick={() => { void handleCreate() }}
            disabled={!canCreate}
            className="mt-2 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isCreating ? 'Creating workspace...' : 'Create Workspace'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
