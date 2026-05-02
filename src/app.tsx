import { useEffect, useState, useCallback } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { initializeTheme } from '@/lib/theme'
import { isEditableTarget } from '@/lib/keyboard'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts'
import { usePrStatusPolling } from '@/hooks/use-pr-status-polling'
import { useTaskSync } from '@/hooks/use-task-sync'
import { useAgentStreamingSync } from '@/hooks/use-agent-streaming-sync'
import { useAutoDetectClis } from '@/hooks/use-cli-path'
import { useUpdater } from '@/hooks/use-updater'
import { Board } from '@/components/layout/board'
import { WorkspaceSetup } from '@/components/layout/workspace-setup'
import { OnboardingWizard } from '@/components/onboarding/onboarding-wizard'
import { TabBar } from '@/components/layout/tab-bar'
import { SettingsPanel } from '@/components/settings/settings-panel'
import { ChecklistPanel } from '@/components/checklist/checklist-panel'
import { AboutModal } from '@/components/about/about-modal'
import { CommandPalette } from '@/components/command-palette/command-palette'
import { ShortcutsModal } from '@/components/shortcuts-modal'
import { SkeletonLoader } from '@/components/shared/skeleton-loader'

function App() {
  const loaded = useWorkspaceStore((s) => s.loaded)
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const load = useWorkspaceStore((s) => s.load)
  const [error, setError] = useState<string | null>(null)
  const [showAbout, setShowAbout] = useState(false)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const {
    pendingUpdate,
    dismissed: updateDismissed,
    installing,
    error: installError,
    dismiss: dismissUpdate,
    install: handleInstallUpdate,
  } = useUpdater()

  // Keyboard shortcuts
  const toggleAbout = useCallback(() => { setShowAbout((prev) => !prev) }, [])
  const toggleCommandPalette = useCallback(() => { setShowCommandPalette((prev) => !prev) }, [])
  const openShortcuts = useCallback(() => { setShowShortcuts(true) }, [])
  const closeShortcuts = useCallback(() => { setShowShortcuts(false) }, [])
  const openSettings = useSettingsStore((s) => s.openSettings)
  useKeyboardShortcuts([
    { key: '/', meta: true, handler: openShortcuts },
    { key: 'k', meta: true, handler: toggleCommandPalette },
    { key: ',', meta: true, handler: openSettings },
  ])

  // Plain `?` opens shortcuts modal (no modifier — guard against editable targets)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      if (event.key !== '?' || event.metaKey || event.ctrlKey || event.altKey) return
      if (isEditableTarget(event.target)) return
      event.preventDefault()
      openShortcuts()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => { window.removeEventListener('keydown', handleKeyDown) }
  }, [openShortcuts])

  // Keep `cmd+?` (alias for cmd+/) — toggleAbout was the prior binding; reroute to about modal via menu/palette.
  // openSettings retained.
  void toggleAbout

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
        <OnboardingWizard onComplete={() => { void load() }} />
      )}

      {/* Tab bar */}
      <TabBar />

      {/* Update available banner */}
      <AnimatePresence>
        {pendingUpdate && !updateDismissed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="flex items-center justify-between bg-accent/10 border-b border-accent/20 px-4 py-2 text-sm">
              <span className="text-text-primary">
                {installError
                  ? <span className="text-error">{installError}</span>
                  : <>Update available: <span className="font-medium">v{pendingUpdate.version}</span></>
                }
              </span>
              <div className="flex items-center gap-3">
                <button
                  onClick={handleInstallUpdate}
                  disabled={installing}
                  className="rounded px-2.5 py-1 text-xs font-medium bg-accent text-white hover:bg-accent/90 disabled:opacity-50 transition-colors"
                >
                  {installing ? 'Installing…' : installError ? 'Retry' : 'Install & Restart'}
                </button>
                <button
                  onClick={dismissUpdate}
                  className="text-text-secondary hover:text-text-primary transition-colors"
                  aria-label="Dismiss"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                  </svg>
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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

      {/* Modals */}
      <AnimatePresence>
        {showAbout && <AboutModal onClose={() => { setShowAbout(false) }} />}
        {showShortcuts && <ShortcutsModal onClose={closeShortcuts} />}
        {showCommandPalette && (
          <CommandPalette
            onClose={() => { setShowCommandPalette(false) }}
            onShowShortcuts={() => { setShowCommandPalette(false); setShowAbout(true) }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

export default App
