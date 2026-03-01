import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import type { Settings, WorkspaceSettings } from '@/types/settings'
import { DEFAULT_SETTINGS } from '@/types/settings'
import { applyAppearance } from '@/lib/appearance'

type SettingsState = {
  global: Settings
  workspaceOverrides: Record<string, WorkspaceSettings>
  isOpen: boolean
  activeTab: string

  // Actions
  openSettings: () => void
  closeSettings: () => void
  setActiveTab: (tab: string) => void
  updateGlobal: <K extends keyof Settings>(key: K, value: Settings[K]) => void
  updateWorkspace: (workspaceId: string, settings: WorkspaceSettings) => void
  getEffective: (workspaceId: string | null) => Settings
  resetToDefaults: () => void
}

export const useSettingsStore = create<SettingsState>()(
  devtools(
    persist(
      (set, get) => ({
        global: DEFAULT_SETTINGS,
        workspaceOverrides: {},
        isOpen: false,
        activeTab: 'appearance',

        openSettings: () => set({ isOpen: true }),
        closeSettings: () => set({ isOpen: false }),
        setActiveTab: (tab) => set({ activeTab: tab }),

        updateGlobal: (key, value) => {
          set((state) => ({
            global: { ...state.global, [key]: value },
          }))
          // Apply appearance changes to DOM immediately
          if (key === 'appearance') {
            applyAppearance(value as Settings['appearance'])
          }
        },

        updateWorkspace: (workspaceId, settings) => {
          set((state) => ({
            workspaceOverrides: {
              ...state.workspaceOverrides,
              [workspaceId]: {
                ...state.workspaceOverrides[workspaceId],
                ...settings,
              },
            },
          }))
        },

        getEffective: (workspaceId) => {
          const { global, workspaceOverrides } = get()
          if (!workspaceId) return global

          const overrides = workspaceOverrides[workspaceId]
          if (!overrides) return global

          // Deep merge global with workspace overrides
          return {
            ...global,
            ...overrides,
            agent: { ...global.agent, ...overrides.agent },
            model: { ...global.model, ...overrides.model },
            voice: { ...global.voice, ...overrides.voice },
            git: { ...global.git, ...overrides.git },
            appearance: { ...global.appearance, ...overrides.appearance },
          } as Settings
        },

        resetToDefaults: () => {
          set({ global: DEFAULT_SETTINGS, workspaceOverrides: {} })
        },
      }),
      {
        name: 'bento-settings',
        partialize: (state) => ({
          global: state.global,
          workspaceOverrides: state.workspaceOverrides,
        }),
      },
    ),
    { name: 'settings-store' },
  ),
)
