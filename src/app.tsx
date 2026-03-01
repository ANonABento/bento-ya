import { useEffect, useState, useCallback } from 'react'
import { AnimatePresence } from 'motion/react'
import { initializeTheme } from '@/lib/theme'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useKeyboardShortcuts } from '@/hooks/use-keyboard-shortcuts'
import { Board } from '@/components/layout/board'
import { WorkspaceSetup } from '@/components/layout/workspace-setup'
import { TabBar } from '@/components/layout/tab-bar'
import { SettingsPanel } from '@/components/settings/settings-panel'
import { ChecklistPanel } from '@/components/checklist/checklist-panel'
import { AboutModal } from '@/components/about/about-modal'
import { SkeletonLoader } from '@/components/shared/skeleton-loader'

function App() {
  const loaded = useWorkspaceStore((s) => s.loaded)
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const load = useWorkspaceStore((s) => s.load)
  const [error, setError] = useState<string | null>(null)
  const [showAbout, setShowAbout] = useState(false)

  // Keyboard shortcuts
  const toggleAbout = useCallback(() => { setShowAbout((prev) => !prev) }, [])
  useKeyboardShortcuts([
    { key: '/', meta: true, handler: toggleAbout },
  ])

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

  const showSetup = loaded && (workspaces.length === 0 || !activeWorkspaceId)

  return (
    <div className="flex h-screen flex-col bg-bg">
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
        {showAbout && <AboutModal onClose={() => { setShowAbout(false) }} />}
      </AnimatePresence>
    </div>
  )
}

export default App
