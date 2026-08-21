import { useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useSettingsStore } from '@/stores/settings-store'
import { WorkspaceTab } from './tabs/workspace-tab'
import { AppearanceTab } from './tabs/appearance-tab'
import { AgentTab } from './tabs/agent-tab'
import { SkillsTab } from './tabs/skills-tab'
import { McpTab } from './tabs/mcp-tab'
import { BoardTab } from './tabs/board-tab'
import { VoiceTab } from './tabs/voice-tab'
import { AdvancedTab } from './tabs/advanced-tab'
import { SystemTab } from './tabs/system-tab'
import { GitTab } from './tabs/git-tab'
import { GithubTab } from './tabs/github-tab'
import { DiscordTab } from './tabs/discord-tab'
import { ShortcutsTab } from './tabs/shortcuts-tab'
import { UpdatesTab } from './tabs/updates-tab'
import { BatchesTab } from './tabs/batches-tab'
import { DebugTab } from './tabs/debug-tab'

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
  skills: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path d="M10 1.5a.75.75 0 0 1 .69.46l1.63 3.85 4.16.36a.75.75 0 0 1 .43 1.31l-3.16 2.74.95 4.07a.75.75 0 0 1-1.12.81L10 12.94l-3.58 2.16a.75.75 0 0 1-1.12-.81l.95-4.07-3.16-2.74a.75.75 0 0 1 .43-1.31l4.16-.36 1.63-3.85A.75.75 0 0 1 10 1.5Z" />
    </svg>
  ),
  mcp: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path d="M12.232 4.232a2.5 2.5 0 0 1 3.536 3.536l-1.225 1.224a.75.75 0 0 0 1.061 1.06l1.224-1.224a4 4 0 0 0-5.656-5.656l-3 3a4 4 0 0 0 .225 5.865.75.75 0 0 0 .977-1.138 2.5 2.5 0 0 1-.142-3.667l3-3Z" />
      <path d="M11.603 7.963a.75.75 0 0 0-.977 1.138 2.5 2.5 0 0 1 .142 3.667l-3 3a2.5 2.5 0 0 1-3.536-3.536l1.225-1.224a.75.75 0 0 0-1.061-1.06l-1.224 1.224a4 4 0 1 0 5.656 5.656l3-3a4 4 0 0 0-.225-5.865Z" />
    </svg>
  ),
  board: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path fillRule="evenodd" d="M.99 5.24A2.25 2.25 0 0 1 3.25 3h13.5A2.25 2.25 0 0 1 19 5.25l.01 9.5A2.25 2.25 0 0 1 16.76 17H3.26A2.267 2.267 0 0 1 1 14.74l-.01-9.5Zm8.26 9.52v-.625a.75.75 0 0 0-.75-.75H3.25a.75.75 0 0 0-.75.75v.615c0 .414.336.75.75.75h5.373a.75.75 0 0 0 .627-.74Zm1.5 0a.75.75 0 0 0 .627.74h5.373a.75.75 0 0 0 .75-.75v-.615a.75.75 0 0 0-.75-.75H11.5a.75.75 0 0 0-.75.75v.625Zm6.75-5.26v-.625a.75.75 0 0 0-.75-.75H11.5a.75.75 0 0 0-.75.75v.625c0 .414.336.75.75.75h5.25a.75.75 0 0 0 .75-.75Zm-8.5 0v-.625a.75.75 0 0 0-.75-.75H3.25a.75.75 0 0 0-.75.75v.625c0 .414.336.75.75.75H8.5a.75.75 0 0 0 .75-.75Z" clipRule="evenodd" />
    </svg>
  ),
  voice: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path d="M7 4a3 3 0 0 1 6 0v6a3 3 0 1 1-6 0V4Z" />
      <path d="M5.5 9.643a.75.75 0 0 0-1.5 0V10c0 3.06 2.29 5.585 5.25 5.954V17.5h-1.5a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 0-1.5h-1.5v-1.546A6.001 6.001 0 0 0 16 10v-.357a.75.75 0 0 0-1.5 0V10a4.5 4.5 0 0 1-9 0v-.357Z" />
    </svg>
  ),
  advanced: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path fillRule="evenodd" d="M8.34 1.804A1 1 0 0 1 9.32 1h1.36a1 1 0 0 1 .98.804l.295 1.473c.497.144.971.342 1.416.587l1.25-.834a1 1 0 0 1 1.262.125l.962.962a1 1 0 0 1 .125 1.262l-.834 1.25c.245.445.443.919.587 1.416l1.473.295a1 1 0 0 1 .804.98v1.36a1 1 0 0 1-.804.98l-1.473.295a6.95 6.95 0 0 1-.587 1.416l.834 1.25a1 1 0 0 1-.125 1.262l-.962.962a1 1 0 0 1-1.262.125l-1.25-.834a6.953 6.953 0 0 1-1.416.587l-.295 1.473a1 1 0 0 1-.98.804H9.32a1 1 0 0 1-.98-.804l-.295-1.473a6.957 6.957 0 0 1-1.416-.587l-1.25.834a1 1 0 0 1-1.262-.125l-.962-.962a1 1 0 0 1-.125-1.262l.834-1.25a6.957 6.957 0 0 1-.587-1.416l-1.473-.295A1 1 0 0 1 1 10.68V9.32a1 1 0 0 1 .804-.98l1.473-.295c.144-.497.342-.971.587-1.416l-.834-1.25a1 1 0 0 1 .125-1.262l.962-.962A1 1 0 0 1 5.38 3.03l1.25.834a6.957 6.957 0 0 1 1.416-.587l.295-1.473ZM13 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" clipRule="evenodd" />
    </svg>
  ),
  github: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path fillRule="evenodd" d="M10 1.944A10.065 10.065 0 0 0 0 12.01c0 4.44 2.865 8.207 6.84 9.537.5.093.683-.217.683-.483 0-.237-.009-.868-.013-1.703-2.782.605-3.369-1.342-3.369-1.342-.454-1.156-1.11-1.463-1.11-1.463-.908-.621.069-.608.069-.608 1.004.071 1.532 1.03 1.532 1.03.891 1.529 2.341 1.088 2.91.832.092-.647.35-1.089.636-1.34-2.22-.253-4.556-1.11-4.556-4.944 0-1.091.39-1.984 1.03-2.682-.103-.253-.447-1.27.097-2.647 0 0 .84-.269 2.75 1.025A9.577 9.577 0 0 1 10 6.836c.85.004 1.705.114 2.504.337 1.909-1.294 2.748-1.025 2.748-1.025.546 1.377.202 2.394.1 2.647.64.698 1.028 1.591 1.028 2.682 0 3.842-2.34 4.688-4.566 4.935.359.309.678.919.678 1.852 0 1.337-.012 2.415-.012 2.742 0 .268.18.58.688.482A10.07 10.07 0 0 0 20 12.01 10.065 10.065 0 0 0 10 1.944Z" clipRule="evenodd" />
    </svg>
  ),
  updates: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h2.433a.75.75 0 0 0 0-1.5H3.989a.75.75 0 0 0-.75.75v4.242a.75.75 0 0 0 1.5 0v-2.43l.31.31a7 7 0 0 0 11.712-3.138.75.75 0 0 0-1.449-.39Zm1.23-3.723a.75.75 0 0 0 .219-.53V2.929a.75.75 0 0 0-1.5 0V5.36l-.31-.31A7 7 0 0 0 3.239 8.188a.75.75 0 1 0 1.448.389A5.5 5.5 0 0 1 13.89 6.11l.311.31h-2.432a.75.75 0 0 0 0 1.5h4.243a.75.75 0 0 0 .53-.219Z" clipRule="evenodd" />
    </svg>
  ),
  discord: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path fillRule="evenodd" d="M10 2c-4.418 0-8 3.134-8 7 0 2.19 1.15 4.145 2.95 5.43-.13.79-.53 1.87-1.36 2.92-.19.24-.02.6.29.56 1.87-.24 3.4-1.06 4.32-1.7.58.12 1.18.19 1.8.19 4.418 0 8-3.134 8-7s-3.582-7-8-7Zm-2.5 8.25a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Zm5 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Z" clipRule="evenodd" />
    </svg>
  ),
  runtime: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path fillRule="evenodd" d="M2 4.75A1.75 1.75 0 0 1 3.75 3h12.5A1.75 1.75 0 0 1 18 4.75v10.5A1.75 1.75 0 0 1 16.25 17H3.75A1.75 1.75 0 0 1 2 15.25V4.75Zm3.03 2.22a.75.75 0 0 0 0 1.06L6.94 10 5.03 11.97a.75.75 0 1 0 1.06 1.06l2.5-2.5a.75.75 0 0 0 0-1.06l-2.5-2.5a.75.75 0 0 0-1.06 0ZM10.75 12a.75.75 0 0 0 0 1.5h3.5a.75.75 0 0 0 0-1.5h-3.5Z" clipRule="evenodd" />
    </svg>
  ),
  debug: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path fillRule="evenodd" d="M10 1a3 3 0 0 0-2.83 2H7a1 1 0 0 0 0 2h6a1 1 0 1 0 0-2h-.17A3 3 0 0 0 10 1ZM4.5 8.5A1.5 1.5 0 0 1 6 7h8a1.5 1.5 0 0 1 1.5 1.5V11a5.5 5.5 0 1 1-11 0V8.5ZM2 9a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0v-1a1 1 0 0 1 1-1Zm16 0a1 1 0 0 1 1 1v1a1 1 0 1 1-2 0v-1a1 1 0 0 1 1-1Z" clipRule="evenodd" />
    </svg>
  ),
  batches: (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
      <path fillRule="evenodd" d="M2 4.25A2.25 2.25 0 0 1 4.25 2h2.5A2.25 2.25 0 0 1 9 4.25v2.5A2.25 2.25 0 0 1 6.75 9h-2.5A2.25 2.25 0 0 1 2 6.75v-2.5Zm0 9A2.25 2.25 0 0 1 4.25 11h2.5A2.25 2.25 0 0 1 9 13.25v2.5A2.25 2.25 0 0 1 6.75 18h-2.5A2.25 2.25 0 0 1 2 15.75v-2.5Zm9-9A2.25 2.25 0 0 1 13.25 2h2.5A2.25 2.25 0 0 1 18 4.25v2.5A2.25 2.25 0 0 1 15.75 9h-2.5A2.25 2.25 0 0 1 11 6.75v-2.5Zm0 9A2.25 2.25 0 0 1 13.25 11h2.5A2.25 2.25 0 0 1 18 13.25v2.5A2.25 2.25 0 0 1 15.75 18h-2.5A2.25 2.25 0 0 1 11 15.75v-2.5Z" clipRule="evenodd" />
    </svg>
  ),
}

type TabId =
  | 'workspace'
  | 'appearance'
  | 'agent'
  | 'skills'
  | 'mcp'
  | 'board'
  | 'voice'
  | 'github'
  | 'discord'
  | 'batches'
  | 'runtime'
  | 'updates'
  | 'advanced'
  | 'debug'

type TabDef = {
  id: TabId
  label: string
  hint: string
}

type TabGroup = {
  id: string
  label: string
  tabs: TabDef[]
}

const TAB_GROUPS: TabGroup[] = [
  {
    id: 'general',
    label: 'General',
    tabs: [
      { id: 'workspace', label: 'Workspace', hint: 'Active workspace, agent defaults, danger zone' },
      { id: 'appearance', label: 'Appearance', hint: 'Theme, accent color, density' },
      { id: 'board', label: 'Board', hint: 'Card display, scripts, templates' },
    ],
  },
  {
    id: 'agents',
    label: 'Agents & Models',
    tabs: [
      { id: 'agent', label: 'Models & Limits', hint: 'Providers, concurrency, budgets, permissions' },
      { id: 'skills', label: 'Skills', hint: 'Reusable capabilities you can attach to an agent' },
      { id: 'voice', label: 'Voice', hint: 'Speech-to-text via Whisper' },
    ],
  },
  {
    id: 'integrations',
    label: 'Integrations',
    tabs: [
      { id: 'github', label: 'GitHub', hint: 'Issue sync and column mapping' },
      { id: 'discord', label: 'Discord', hint: 'Mirror the board to Discord threads' },
      { id: 'mcp', label: 'MCP Server', hint: 'Connect external agents to the board' },
      { id: 'batches', label: 'Batches', hint: 'Grouped task PR workflows' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    tabs: [
      { id: 'runtime', label: 'Runtime', hint: 'Global defaults, sessions, GC, limits' },
      { id: 'advanced', label: 'Advanced', hint: 'Terminal, panels, performance, git, shortcuts' },
      { id: 'debug', label: 'Debug', hint: 'Inspect CLI prompts, args, and tool calls' },
      { id: 'updates', label: 'Updates', hint: 'Check for app updates' },
    ],
  },
]

const ALL_TABS: TabDef[] = TAB_GROUPS.flatMap((g) => g.tabs)

function tabHeading(id: string): { title: string; hint: string } {
  const t = ALL_TABS.find((x) => x.id === id)
  return t ? { title: t.label, hint: t.hint } : { title: 'Settings', hint: '' }
}

export function SettingsPanel() {
  const isOpen = useSettingsStore((s) => s.isOpen)
  const closeSettings = useSettingsStore((s) => s.closeSettings)
  const activeTab = useSettingsStore((s) => s.activeTab)
  const setActiveTab = useSettingsStore((s) => s.setActiveTab)

  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSettings()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => { window.removeEventListener('keydown', handleKeyDown) }
  }, [isOpen, closeSettings])

  // Move focus into the panel on open so keyboard / screen-reader users start
  // inside the modal rather than wherever focus was when Settings opened.
  useEffect(() => {
    if (!isOpen) return
    const id = requestAnimationFrame(() => { closeButtonRef.current?.focus() })
    return () => { cancelAnimationFrame(id) }
  }, [isOpen])

  // Trap Tab/Shift+Tab inside the panel.
  const handlePanelKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Tab') return
    const panel = panelRef.current
    if (!panel) return
    const focusables = panel.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (!first || !last) return
    const active = document.activeElement as HTMLElement | null
    if (e.shiftKey && (active === first || !panel.contains(active))) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && active === last) {
      e.preventDefault()
      first.focus()
    }
  }

  const renderTabContent = () => {
    switch (activeTab) {
      case 'workspace':
        return <WorkspaceTab />
      case 'appearance':
        return <AppearanceTab />
      case 'agent':
        return <AgentTab />
      case 'skills':
        return <SkillsTab />
      case 'mcp':
        return <McpTab />
      case 'board':
        return <BoardTab />
      case 'voice':
        return <VoiceTab />
      case 'github':
        return <GithubTab />
      case 'discord':
        return <DiscordTab />
      case 'batches':
        return <BatchesTab />
      case 'runtime':
        return <SystemTab />
      case 'debug':
        return <DebugTab />
      case 'updates':
        return <UpdatesTab />
      case 'advanced':
        return (
          <div className="space-y-10">
            <AdvancedTab />
            <section>
              <header className="mb-4 border-t border-border-default pt-6">
                <h3 className="text-sm font-semibold text-text-primary">Git</h3>
                <p className="mt-0.5 text-xs text-text-secondary">
                  Branch prefixes and merge strategy for auto-generated PRs.
                </p>
              </header>
              <GitTab />
            </section>
            <section>
              <header className="mb-4 border-t border-border-default pt-6">
                <h3 className="text-sm font-semibold text-text-primary">Keyboard Shortcuts</h3>
                <p className="mt-0.5 text-xs text-text-secondary">
                  Customize hotkeys for common actions.
                </p>
              </header>
              <ShortcutsTab />
            </section>
          </div>
        )
      default:
        return <WorkspaceTab />
    }
  }

  const heading = tabHeading(activeTab)

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
            aria-hidden="true"
            className="fixed inset-0 z-40 bg-black/50"
          />

          {/* Panel — responsive width: wider on large screens, full-width on mobile */}
          <motion.div
            ref={panelRef}
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="settings-title"
            onKeyDown={handlePanelKeyDown}
            className="fixed right-0 top-0 z-50 flex h-full w-full max-w-full flex-col border-l border-border-default bg-bg shadow-2xl lg:max-w-4xl xl:max-w-5xl"
          >
            {/* Header */}
            <div className="flex items-center justify-between border-b border-border-default px-6 py-4">
              <h2 id="settings-title" className="text-lg font-semibold text-text-primary">Settings</h2>
              <button
                ref={closeButtonRef}
                onClick={closeSettings}
                className="rounded-lg p-2 text-text-secondary transition-colors hover:bg-surface hover:text-text-primary"
                title="Close settings"
                aria-label="Close settings"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                  <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
                </svg>
              </button>
            </div>

            {/* Mobile section picker — only visible on narrow viewports */}
            <div className="block border-b border-border-default px-4 py-2 lg:hidden">
              <select
                value={activeTab}
                onChange={(e) => { setActiveTab(e.target.value) }}
                className="w-full rounded-md border border-border-default bg-surface px-2 py-1.5 text-sm text-text-primary"
                aria-label="Settings section"
              >
                {TAB_GROUPS.map((group) => (
                  <optgroup key={group.id} label={group.label}>
                    {group.tabs.map((tab) => (
                      <option key={tab.id} value={tab.id}>{tab.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            {/* Content */}
            <div className="flex flex-1 overflow-hidden">
              {/* Tab sidebar with groups — hidden on mobile */}
              <nav className="hidden w-56 shrink-0 overflow-y-auto border-r border-border-default bg-surface/40 p-3 lg:block">
                {TAB_GROUPS.map((group) => (
                  <div key={group.id} className="mb-4">
                    <div className="mb-1 px-2 text-xs font-semibold uppercase tracking-wider text-text-secondary/70">
                      {group.label}
                    </div>
                    {group.tabs.map((tab) => (
                      <button
                        key={tab.id}
                        onClick={() => { setActiveTab(tab.id) }}
                        title={tab.hint}
                        className={`mb-0.5 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                          activeTab === tab.id
                            ? 'bg-accent/10 text-accent'
                            : 'text-text-secondary hover:bg-surface hover:text-text-primary'
                        }`}
                      >
                        {icons[tab.id]}
                        <span className="truncate">{tab.label}</span>
                      </button>
                    ))}
                  </div>
                ))}
              </nav>

              {/* Tab content with sticky tab heading */}
              <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <header className="shrink-0 border-b border-border-default bg-bg/80 px-6 py-3 backdrop-blur">
                  <h3 className="text-base font-semibold text-text-primary">{heading.title}</h3>
                  {heading.hint && (
                    <p className="mt-0.5 text-xs text-text-secondary">{heading.hint}</p>
                  )}
                </header>
                <div className="flex-1 overflow-y-auto px-6 py-6">
                  {/* Forms read better at a comfortable measure on dense
                      tabs (board toggles, advanced inputs), so cap content
                      width — but at a wider stop on big screens so we don't
                      leave a yawning gutter on 1440px+. */}
                  <div className="mx-auto w-full max-w-3xl xl:max-w-4xl">
                    {renderTabContent()}
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
