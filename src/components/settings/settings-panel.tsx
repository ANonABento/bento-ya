import { motion, AnimatePresence } from 'motion/react'
import { useSettingsStore } from '@/stores/settings-store'
import { AppearanceTab } from './tabs/appearance-tab'
import { AgentTab } from './tabs/agent-tab'
import { GitTab } from './tabs/git-tab'
import { VoiceTab } from './tabs/voice-tab'
import { ShortcutsTab } from './tabs/shortcuts-tab'
import { TemplatesTab } from './tabs/templates-tab'
import { WorkspaceTab } from './tabs/workspace-tab'

// SVG Icons for settings tabs
const icons: Record<string, React.ReactNode> = {
  workspace: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path fillRule="evenodd" d="M3.25 3A2.25 2.25 0 0 0 1 5.25v9.5A2.25 2.25 0 0 0 3.25 17h13.5A2.25 2.25 0 0 0 19 14.75v-7.5A2.25 2.25 0 0 0 16.75 5H9.766a1.25 1.25 0 0 1-.927-.405l-.845-.959A2.25 2.25 0 0 0 6.292 3H3.25Z" clipRule="evenodd" />
    </svg>
  ),
  appearance: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path fillRule="evenodd" d="M3.5 2A1.5 1.5 0 0 0 2 3.5V15a3 3 0 1 0 6 0V3.5A1.5 1.5 0 0 0 6.5 2h-3Zm11.753 6.99L9.5 14.743V6.257l1.51-1.51a1.5 1.5 0 0 1 2.122 0l2.121 2.121a1.5 1.5 0 0 1 0 2.122ZM8.364 18H16.5a1.5 1.5 0 0 0 1.5-1.5v-3a1.5 1.5 0 0 0-1.5-1.5h-2.136l-6 6Z" clipRule="evenodd" />
    </svg>
  ),
  agent: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path d="M10 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM3.465 14.493a1.23 1.23 0 0 0 .41 1.412A9.957 9.957 0 0 0 10 18c2.31 0 4.438-.784 6.131-2.1.43-.333.604-.903.408-1.41a7.002 7.002 0 0 0-13.074.003Z" />
    </svg>
  ),
  templates: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path fillRule="evenodd" d="M3 3.5A1.5 1.5 0 0 1 4.5 2h6.879a1.5 1.5 0 0 1 1.06.44l4.122 4.12A1.5 1.5 0 0 1 17 7.622V16.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 16.5v-13Zm10.857 5.691a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clipRule="evenodd" />
    </svg>
  ),
  git: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path fillRule="evenodd" d="M4.25 2A2.25 2.25 0 0 0 2 4.25v2.5A2.25 2.25 0 0 0 4.25 9h2.5A2.25 2.25 0 0 0 9 6.75v-2.5A2.25 2.25 0 0 0 6.75 2h-2.5Zm0 9A2.25 2.25 0 0 0 2 13.25v2.5A2.25 2.25 0 0 0 4.25 18h2.5A2.25 2.25 0 0 0 9 15.75v-2.5A2.25 2.25 0 0 0 6.75 11h-2.5Zm9-9A2.25 2.25 0 0 0 11 4.25v2.5A2.25 2.25 0 0 0 13.25 9h2.5A2.25 2.25 0 0 0 18 6.75v-2.5A2.25 2.25 0 0 0 15.75 2h-2.5Zm0 9A2.25 2.25 0 0 0 11 13.25v2.5A2.25 2.25 0 0 0 13.25 18h2.5A2.25 2.25 0 0 0 18 15.75v-2.5A2.25 2.25 0 0 0 15.75 11h-2.5Z" clipRule="evenodd" />
    </svg>
  ),
  voice: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path d="M7 4a3 3 0 0 1 6 0v6a3 3 0 1 1-6 0V4Z" />
      <path d="M5.5 9.643a.75.75 0 0 0-1.5 0V10c0 3.06 2.29 5.585 5.25 5.954V17.5h-1.5a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 0-1.5h-1.5v-1.546A6.001 6.001 0 0 0 16 10v-.357a.75.75 0 0 0-1.5 0V10a4.5 4.5 0 0 1-9 0v-.357Z" />
    </svg>
  ),
  shortcuts: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path fillRule="evenodd" d="M2 4.75A.75.75 0 0 1 2.75 4h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 4.75Zm7 10.5a.75.75 0 0 1 .75-.75h7.5a.75.75 0 0 1 0 1.5h-7.5a.75.75 0 0 1-.75-.75ZM2 10a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 0 1.5H2.75A.75.75 0 0 1 2 10Z" clipRule="evenodd" />
    </svg>
  ),
}

const TABS = [
  { id: 'workspace', label: 'Workspace' },
  { id: 'appearance', label: 'Appearance' },
  { id: 'agent', label: 'Agent' },
  { id: 'templates', label: 'Templates' },
  { id: 'git', label: 'Git' },
  { id: 'voice', label: 'Voice' },
  { id: 'shortcuts', label: 'Shortcuts' },
] as const

export function SettingsPanel() {
  const isOpen = useSettingsStore((s) => s.isOpen)
  const closeSettings = useSettingsStore((s) => s.closeSettings)
  const activeTab = useSettingsStore((s) => s.activeTab)
  const setActiveTab = useSettingsStore((s) => s.setActiveTab)

  const renderTabContent = () => {
    switch (activeTab) {
      case 'workspace':
        return <WorkspaceTab />
      case 'appearance':
        return <AppearanceTab />
      case 'agent':
        return <AgentTab />
      case 'templates':
        return <TemplatesTab />
      case 'git':
        return <GitTab />
      case 'voice':
        return <VoiceTab />
      case 'shortcuts':
        return <ShortcutsTab />
      default:
        return <AppearanceTab />
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={closeSettings}
            className="fixed inset-0 z-40 bg-black/50"
          />

          {/* Panel */}
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            className="fixed right-0 top-0 z-50 flex h-full w-full max-w-2xl flex-col border-l border-border-default bg-bg shadow-2xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border-default px-6 py-4">
              <h2 className="text-lg font-semibold text-text-primary">Settings</h2>
              <button
                onClick={closeSettings}
                className="rounded-lg p-2 text-text-secondary transition-colors hover:bg-surface hover:text-text-primary"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                  <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="flex flex-1 overflow-hidden">
              {/* Tab sidebar */}
              <nav className="w-48 shrink-0 border-r border-border-default bg-surface/50 p-2">
                {TABS.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`mb-1 flex w-full items-center gap-2 rounded px-3 py-2 text-left text-sm transition-colors ${
                      activeTab === tab.id
                        ? 'bg-accent/10 text-accent'
                        : 'text-text-secondary hover:bg-surface hover:text-text-primary'
                    }`}
                  >
                    {icons[tab.id]}
                    <span>{tab.label}</span>
                  </button>
                ))}
              </nav>

              {/* Tab content */}
              <div className="flex-1 overflow-y-auto p-6">
                {renderTabContent()}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
