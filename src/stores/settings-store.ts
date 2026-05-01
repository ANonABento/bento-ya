import { create } from 'zustand'
import { devtools, persist } from 'zustand/middleware'
import type { Settings, WorkspaceSettings } from '@/types/settings'
import { DEFAULT_SETTINGS } from '@/types/settings'
import { applyAppearance } from '@/lib/appearance'
import { registerSettingsClose, closeOtherPanels } from '@/lib/panel-coordination'

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
  loadWorkspaceSettings: (workspaceId: string, settings: WorkspaceSettings) => void
  getEffective: (workspaceId: string | null) => Settings
  resetToDefaults: () => void
}

type PersistedSettingsState = Partial<Pick<SettingsState, 'global' | 'workspaceOverrides'>>

export function normalizeSettings(settings: Partial<Settings> | undefined): Settings {
  const model = settings?.model

  return {
    ...DEFAULT_SETTINGS,
    ...settings,
    agent: { ...DEFAULT_SETTINGS.agent, ...settings?.agent },
    model: {
      ...DEFAULT_SETTINGS.model,
      ...model,
      dailyTokenBudgets: {
        ...DEFAULT_SETTINGS.model.dailyTokenBudgets,
        ...model?.dailyTokenBudgets,
      },
    },
    voice: { ...DEFAULT_SETTINGS.voice, ...settings?.voice },
    git: { ...DEFAULT_SETTINGS.git, ...settings?.git },
    appearance: { ...DEFAULT_SETTINGS.appearance, ...settings?.appearance },
    cards: { ...DEFAULT_SETTINGS.cards, ...settings?.cards },
    terminal: { ...DEFAULT_SETTINGS.terminal, ...settings?.terminal },
    panel: { ...DEFAULT_SETTINGS.panel, ...settings?.panel },
    gestures: { ...DEFAULT_SETTINGS.gestures, ...settings?.gestures },
    advanced: { ...DEFAULT_SETTINGS.advanced, ...settings?.advanced },
    workspaceDefaults: { ...DEFAULT_SETTINGS.workspaceDefaults, ...settings?.workspaceDefaults },
  }
}

export const useSettingsStore = create<SettingsState>()(
  devtools(
    persist(
      (set, get) => ({
        global: DEFAULT_SETTINGS,
        workspaceOverrides: {},
        isOpen: false,
        activeTab: 'workspace',

        openSettings: () => {
          closeOtherPanels('settings')
          set({ isOpen: true })
        },
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

        loadWorkspaceSettings: (workspaceId, settings) => {
          // Replace workspace settings entirely (used when loading from backend)
          set((state) => ({
            workspaceOverrides: {
              ...state.workspaceOverrides,
              [workspaceId]: settings,
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
            cards: { ...global.cards, ...overrides.cards },
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
        merge: (persisted, current) => {
          const persistedState = persisted as PersistedSettingsState | undefined

          return {
            ...current,
            global: normalizeSettings(persistedState?.global),
            workspaceOverrides: persistedState?.workspaceOverrides ?? {},
          }
        },
      },
    ),
    { name: 'settings-store' },
  ),
)

// Register with panel coordination (no circular import)
registerSettingsClose(() => { useSettingsStore.getState().closeSettings() })
