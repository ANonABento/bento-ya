import { useState, useEffect, useCallback } from 'react'
import { motion } from 'motion/react'
import { getCurrentBranch, detectClis, checkRuntimePrerequisites, updateAppSettings } from '@/lib/ipc'
import type { DetectedCli } from '@/lib/ipc/cli'
import type { RuntimePrerequisite } from '@/lib/ipc/system'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { PathPicker } from '@/components/shared/path-picker'
import { BUILT_IN_TEMPLATES } from '@/types/templates'
import { useNativeInput } from '@/hooks/use-native-input'
import { getErrorMessage } from '@/lib/errors'

type OnboardingWizardProps = {
  onComplete: () => void
}

type GitStatus = 'valid' | 'invalid' | 'empty' | 'checking' | null

export function OnboardingWizard({ onComplete }: OnboardingWizardProps) {
  const [name, setName] = useState('')
  const [repoPath, setRepoPath] = useState('')
  const [template, setTemplate] = useState('standard')
  const [runtimeMode, setRuntimeMode] = useState<'headless' | 'interactive'>('headless')
  const [selectedClis, setSelectedClis] = useState<Set<string>>(new Set())
  const [isCreating, setIsCreating] = useState(false)
  const [gitStatus, setGitStatus] = useState<GitStatus>(null)
  const [error, setError] = useState<string | null>(null)
  const [detectedClis, setDetectedClis] = useState<DetectedCli[]>([])
  const [prerequisites, setPrerequisites] = useState<RuntimePrerequisite[]>([])
  const [checkingPrereqs, setCheckingPrereqs] = useState(false)

  const addWorkspace = useWorkspaceStore((s) => s.add)
  const setActive = useWorkspaceStore((s) => s.setActive)

  const nameInput = useNativeInput(setName)

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
  }, [])

  const refreshPrerequisites = useCallback(async () => {
    setCheckingPrereqs(true)
    try {
      setPrerequisites(await checkRuntimePrerequisites())
    } catch {
      setPrerequisites([])
    } finally {
      setCheckingPrereqs(false)
    }
  }, [])

  useEffect(() => {
    void refreshPrerequisites()
  }, [refreshPrerequisites])

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
      const defaultAgentCli = Array.from(selectedClis)[0]
      const created = await addWorkspace(trimmedName, trimmedPath, {
        templateId: template,
        ...(defaultAgentCli ? { defaultAgentCli } : {}),
      })
      // Persist the runtime choice globally (these live in backend AppSettings,
      // not the workspace). Interactive is opt-in, so only flip when chosen.
      if (runtimeMode === 'interactive') {
        await updateAppSettings({
          interactive_mode_enabled: true,
          default_runtime_mode: 'interactive',
        }).catch((err: unknown) => { console.error('Failed to save runtime mode:', err) })
      }
      setActive(created.id)
      onComplete()
    } catch (err: unknown) {
      const message = getErrorMessage(err)
      setError(message)
    } finally {
      setIsCreating(false)
    }
  }, [name, repoPath, selectedClis, template, runtimeMode, addWorkspace, setActive, onComplete])

  const canCreate = repoPath.trim().length > 0 && gitStatus === 'valid' && !isCreating
  const missingRequiredPrereqs = prerequisites.filter((item) => item.required && !item.available)

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
          <h2 className="text-xl font-semibold text-text-primary">Welcome to KaitenCode</h2>
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
              ref={nameInput.ref}
              id="onboard-name"
              type="text"
              value={name}
              onChange={nameInput.handleChange}
              placeholder="My Project"
              data-testid="onboard-name"
              className="w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
          </div>

          {/* Repository path */}
          <div>
            <label htmlFor="onboard-path" className="mb-1 block text-xs font-medium text-text-secondary">
              Repository Path
            </label>
            <PathPicker
              value={repoPath}
              onChange={(path) => { setRepoPath(path); setError(null) }}
              onError={setError}
              placeholder="/Users/you/project"
            />
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
                  Select a folder inside a local git repository.
                </p>
              </div>
            )}
          </div>

          {/* Template & Agent — grouped */}
          <div className="space-y-3 rounded-lg border border-border-default bg-bg p-3">
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <label className="block text-xs font-medium text-text-secondary">
                  System check
                </label>
                <button
                  type="button"
                  onClick={() => { void refreshPrerequisites() }}
                  disabled={checkingPrereqs}
                  style={{ cursor: checkingPrereqs ? 'not-allowed' : 'pointer' }}
                  className="rounded border border-border-default px-2 py-0.5 text-xs text-text-secondary hover:bg-surface-hover disabled:opacity-50"
                >
                  {checkingPrereqs ? 'Checking...' : 'Recheck'}
                </button>
              </div>
              <div className="space-y-1">
                {prerequisites.map((item) => (
                  <div
                    key={item.id}
                    className="flex items-center justify-between gap-3 rounded-md border border-border-default bg-surface px-3 py-1.5 text-xs"
                    title={item.available ? (item.version ?? item.name) : item.installHint}
                  >
                    <span className="text-text-primary">{item.name}</span>
                    <span className={item.available ? 'text-success' : item.required ? 'text-error' : 'text-yellow-500'}>
                      {item.available ? (item.version ?? 'Available') : item.required ? 'Required' : 'Optional'}
                    </span>
                  </div>
                ))}
                {!checkingPrereqs && prerequisites.length === 0 && (
                  <p className="rounded-md border border-border-default bg-surface px-3 py-1.5 text-xs text-text-secondary">
                    System check unavailable. You can continue and configure tools later.
                  </p>
                )}
              </div>
              {missingRequiredPrereqs.length > 0 && (
                <p className="mt-1 text-xs text-error">
                  Install {missingRequiredPrereqs.map((item) => item.name).join(', ')} before running agents or terminals.
                </p>
              )}
            </div>

            <div>
              <label htmlFor="onboard-template" className="mb-1 block text-xs font-medium text-text-secondary">
                Template
              </label>
              <select
                id="onboard-template"
                value={template}
                onChange={(e) => { setTemplate(e.target.value) }}
                className="w-full rounded-md border border-border-default bg-surface px-3 py-1.5 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              >
                {BUILT_IN_TEMPLATES.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name} ({t.columns.length} columns)
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">
                Agent
              </label>
              {detectedClis.length > 0 ? (
                <div className="space-y-1.5">
                  {detectedClis.map((cli) => (
                    <label
                      key={cli.id}
                      className="flex items-center gap-3 rounded-md border border-border-default bg-surface px-3 py-1.5 transition-colors hover:bg-surface-hover"
                      style={{ cursor: 'pointer' }}
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
                      <span className="text-sm text-text-primary">{cli.name}</span>
                      {cli.version && <span className="ml-auto text-xs text-text-secondary">{cli.version}</span>}
                    </label>
                  ))}
                </div>
              ) : (
                <p className="rounded-md border border-border-default bg-surface px-3 py-1.5 text-sm text-text-secondary">
                  No agent CLIs detected. You can configure one later in Settings.
                </p>
              )}
            </div>

            <div>
              <label className="mb-1 block text-xs font-medium text-text-secondary">
                Agent runtime
              </label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  { id: 'headless', name: 'Headless', blurb: 'Pipelined CLI. Bills against API / Agent-SDK credit.' },
                  { id: 'interactive', name: 'Interactive', blurb: 'Live CLI TUI you can steer. Uses subscription limits.' },
                ] as const).map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => { setRuntimeMode(opt.id) }}
                    className={`rounded-md border px-3 py-2 text-left transition-colors ${
                      runtimeMode === opt.id
                        ? 'border-accent bg-accent/10'
                        : 'border-border-default bg-surface hover:bg-surface-hover'
                    }`}
                    style={{ cursor: 'pointer' }}
                  >
                    <div className="text-sm font-medium text-text-primary">{opt.name}</div>
                    <div className="mt-0.5 text-xs text-text-secondary">{opt.blurb}</div>
                  </button>
                ))}
              </div>
              <p className="mt-1 text-xs text-text-secondary">
                Headless is the recommended default. You can change this anytime in Settings → Agent.
              </p>
            </div>
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
            style={{ cursor: canCreate ? undefined : 'not-allowed' }}
            className="mt-2 w-full rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent/90 disabled:opacity-50"
          >
            {isCreating ? 'Creating workspace...' : 'Create Workspace'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}
