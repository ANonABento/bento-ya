import { motion, AnimatePresence } from 'motion/react'
import { useSettingsStore } from '@/stores/settings-store'
import { AppearanceTab } from './tabs/appearance-tab'
import { AgentTab } from './tabs/agent-tab'
import { GitTab } from './tabs/git-tab'
import { VoiceTab } from './tabs/voice-tab'
import { ShortcutsTab } from './tabs/shortcuts-tab'

const TABS = [
  { id: 'appearance', label: 'Appearance', icon: '🎨' },
  { id: 'agent', label: 'Agent', icon: '🤖' },
  { id: 'git', label: 'Git', icon: '🔀' },
  { id: 'voice', label: 'Voice', icon: '🎤' },
  { id: 'shortcuts', label: 'Shortcuts', icon: '⌨️' },
] as const

export function SettingsPanel() {
  const isOpen = useSettingsStore((s) => s.isOpen)
  const closeSettings = useSettingsStore((s) => s.closeSettings)
  const activeTab = useSettingsStore((s) => s.activeTab)
  const setActiveTab = useSettingsStore((s) => s.setActiveTab)

  const renderTabContent = () => {
    switch (activeTab) {
      case 'appearance':
        return <AppearanceTab />
      case 'agent':
        return <AgentTab />
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
                    className={`mb-1 flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                      activeTab === tab.id
                        ? 'bg-accent/10 text-accent'
                        : 'text-text-secondary hover:bg-surface hover:text-text-primary'
                    }`}
                  >
                    <span>{tab.icon}</span>
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
