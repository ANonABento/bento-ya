import { useEffect, useState, useCallback } from 'react'
import { AnimatePresence } from 'motion/react'
import { initializeTheme } from '@/lib/theme'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useSettingsStore } from '@/stores/settings-store'
import {
  checkUpdateIfAvailable,
  installPendingUpdate,
  isTauriRuntime,
  type AppUpdateResult,
} from '@/lib/update'
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts'
import { usePrStatusPolling } from '@/hooks/use-pr-status-polling'
import { useTaskSync } from '@/hooks/use-task-sync'
import { useAgentStreamingSync } from '@/hooks/use-agent-streaming-sync'
import { useAutoDetectClis } from '@/hooks/use-cli-path'
import { Board } from '@/components/layout/board'
import { WorkspaceSetup } from '@/components/layout/workspace-setup'
import { OnboardingWizard } from '@/components/onboarding/onboarding-wizard'
import { TabBar } from '@/components/layout/tab-bar'
import { SettingsPanel } from '@/components/settings/settings-panel'
import { ChecklistPanel } from '@/components/checklist/checklist-panel'
import { AboutModal } from '@/components/about/about-modal'
import { CommandPalette } from '@/components/command-palette/command-palette'
import { SkeletonLoader } from '@/components/shared/skeleton-loader'

function App() {
  const loaded = useWorkspaceStore((s) => s.loaded)
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const load = useWorkspaceStore((s) => s.load)
  const [error, setError] = useState<string | null>(null)
  const [showAbout, setShowAbout] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [appUpdate, setAppUpdate] = useState<AppUpdateResult | null>(null)
  const [appUpdateError, setAppUpdateError] = useState<string | null>(null)
  const [isInstallingAppUpdate, setIsInstallingAppUpdate] = useState(false)
  const [installCompleted, setInstallCompleted] = useState(false)

  // Keyboard shortcuts
  const toggleAbout = useCallback(() => {
    setShowAbout((prev) => !prev)
  }, [])
  const toggleCommandPalette = useCallback(() => {
    setShowCommandPalette((prev) => !prev)
  }, [])
  const openSettings = useSettingsStore((s) => s.openSettings)
  useKeyboardShortcuts([
    { key: '/', meta: true, handler: toggleAbout },
    { key: 'k', meta: true, handler: toggleCommandPalette },
    { key: ',', meta: true, handler: openSettings },
  ])

  // Auto-detect CLI paths on startup
  useAutoDetectClis()

  // PR status polling (auto-refreshes PR status for tasks with PRs)
  usePrStatusPolling({ enabled: !!activeWorkspaceId })

  // Task sync (re-fetches task store when backend mutates tasks)
  useTaskSync(activeWorkspaceId)

  // Agent streaming sync (routes agent events to streaming store for live card updates)
  useAgentStreamingSync()

  useEffect(() => {
    const cleanup = initializeTheme()
    return cleanup
  }, [])

  useEffect(() => {
    if (!isTauriRuntime()) {
      return
    }

    void checkUpdateIfAvailable()
      .then((update) => {
        if (update) {
          setAppUpdate(update)
        }
      })
      .catch((error: unknown) => {
        setAppUpdateError(error instanceof Error ? error.message : 'Failed to check for updates')
      })
  }, [])

  const installAppUpdate = async () => {
    if (!appUpdate || isInstallingAppUpdate) return

    setIsInstallingAppUpdate(true)
    setAppUpdateError(null)
    try {
      await installPendingUpdate()
      setInstallCompleted(true)
    } catch (error: unknown) {
      setAppUpdateError(error instanceof Error ? error.message : 'Failed to install update')
    } finally {
      setIsInstallingAppUpdate(false)
    }
  }

  // Load workspaces on mount
  useEffect(() => {
    load().catch((err: unknown) => {
      setError(err instanceof Error ? err.message : 'Failed to load workspaces')
    })
  }, [load])

  const isFirstLaunch = loaded && workspaces.length === 0
  const showSetup = loaded && !isFirstLaunch && !activeWorkspaceId

  return (
    <div className="flex h-screen flex-col bg-bg">
      {/* Onboarding wizard (full-screen overlay on first launch) */}
      {isFirstLaunch && (
        <OnboardingWizard
          onComplete={() => {
            void load()
          }}
        />
      )}

      {/* Tab bar */}
      <TabBar />

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        {error ? (
          <div className="flex h-full items-center justify-center">
            <div className="rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">
              {error}
            </div>
          </div>
        ) : !loaded ? (
          <SkeletonLoader />
        ) : showSetup ? (
          <WorkspaceSetup />
        ) : (
          <Board />
        )}
      </main>

      {/* Slide-over panels */}
      <SettingsPanel />
      <ChecklistPanel />

      {appUpdate && !installCompleted && (
        <div
          role="status"
          className="fixed left-3 right-3 top-3 z-[200] flex w-full max-w-sm gap-3 rounded-lg border border-accent/30 bg-surface p-3 shadow-lg"
        >
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-text-primary">Update available</div>
            <div className="mt-1 text-xs text-text-secondary">
              Version <span className="font-mono text-text-primary">{appUpdate.version}</span> is
              available.
            </div>
            {appUpdate.body && (
              <div className="mt-1.5 text-xs text-text-secondary whitespace-pre-wrap">
                {appUpdate.body}
              </div>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <button
              onClick={() => {
                void installAppUpdate()
              }}
              disabled={isInstallingAppUpdate}
              className="rounded-lg border border-accent bg-accent/10 px-2.5 py-1 text-xs text-accent transition-colors hover:bg-accent/20 disabled:opacity-50"
              style={{ cursor: isInstallingAppUpdate ? 'default' : 'pointer' }}
            >
              {isInstallingAppUpdate ? 'Installing…' : 'Install'}
            </button>
            <button
              onClick={() => {
                setAppUpdate(null)
                setInstallCompleted(false)
              }}
              className="rounded-lg border border-border-default px-2.5 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-hover"
              style={{ cursor: 'pointer' }}
            >
              Dismiss
            </button>
          </div>
          {appUpdateError && (
            <div className="absolute inset-x-3 top-full mt-1 text-xs text-error">
              {appUpdateError}
            </div>
          )}
        </div>
      )}

      {installCompleted && appUpdate && (
        <div className="fixed inset-x-0 top-4 z-[200] mx-auto flex w-full max-w-md rounded-lg border border-green-400/30 bg-surface p-3 shadow-lg">
          <p className="text-xs text-text-secondary">
            Update installed for version{' '}
            <span className="font-mono text-text-primary">{appUpdate.version}</span>. Restart the
            app to use the new version.
          </p>
        </div>
      )}

      {/* Modals */}
      <AnimatePresence>
        {showAbout && (
          <AboutModal
            onClose={() => {
              setShowAbout(false)
            }}
          />
        )}
        {showCommandPalette && (
          <CommandPalette
            onClose={() => {
              setShowCommandPalette(false)
            }}
            onShowShortcuts={() => {
              setShowCommandPalette(false)
              setShowAbout(true)
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

export default App
