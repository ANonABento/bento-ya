import { useEffect, useState, useCallback } from 'react'
import { AnimatePresence } from 'motion/react'
import { initializeTheme } from '@/lib/theme'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useSettingsStore } from '@/stores/settings-store'
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
import { CommandPalette } from '@/components/command-palette/command-palette'
import { ShortcutsModal } from '@/components/shortcuts-modal'
import { SkeletonLoader } from '@/components/shared/skeleton-loader'

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false

  const tagName = target.tagName
  return (
    tagName === 'INPUT' ||
    tagName === 'TEXTAREA' ||
    tagName === 'SELECT' ||
    target.isContentEditable
  )
}

function App() {
  const loaded = useWorkspaceStore((s) => s.loaded)
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const load = useWorkspaceStore((s) => s.load)
  const [error, setError] = useState<string | null>(null)
  const [showCommandPalette, setShowCommandPalette] = useState(false)
  const [showShortcuts, setShowShortcuts] = useState(false)

  // Keyboard shortcuts
  const toggleCommandPalette = useCallback(() => { setShowCommandPalette((prev) => !prev) }, [])
  const openShortcuts = useCallback(() => { setShowShortcuts(true) }, [])
  const openSettings = useSettingsStore((s) => s.openSettings)
  useKeyboardShortcuts([
    { key: '/', meta: true, handler: openShortcuts },
    { key: 'k', meta: true, handler: toggleCommandPalette },
    { key: ',', meta: true, handler: openSettings },
  ])

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
        {showShortcuts && <ShortcutsModal onClose={() => { setShowShortcuts(false) }} />}
        {showCommandPalette && (
          <CommandPalette
            onClose={() => { setShowCommandPalette(false) }}
            onShowShortcuts={() => { setShowCommandPalette(false); setShowShortcuts(true) }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

export default App
