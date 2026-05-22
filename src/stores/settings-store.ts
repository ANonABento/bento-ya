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

type PersistedSettings = Omit<
  Partial<Settings>,
  | 'agent'
  | 'model'
  | 'voice'
  | 'git'
  | 'appearance'
  | 'cards'
  | 'terminal'
  | 'panel'
  | 'gestures'
  | 'advanced'
  | 'workspaceDefaults'
> & {
  agent?: Partial<Settings['agent']>
  model?: Partial<Settings['model']>
  voice?: Partial<Settings['voice']>
  git?: Partial<Settings['git']>
  appearance?: Partial<Settings['appearance']>
  cards?: Partial<Settings['cards']>
  terminal?: Partial<Settings['terminal']>
  panel?: Partial<Settings['panel']>
  gestures?: Partial<Settings['gestures']>
  advanced?: Partial<Settings['advanced']>
  workspaceDefaults?: Partial<Settings['workspaceDefaults']>
}

type PersistedSettingsState = {
  global?: PersistedSettings
  workspaceOverrides?: SettingsState['workspaceOverrides']
}

function stripSecretEnvVars<T extends { agent?: Partial<Settings['agent']> }>(settings: T): T {
  if (!settings.agent) return settings
  return {
    ...settings,
    agent: {
      ...settings.agent,
      envVars: {},
    },
  }
}

function sanitizeWorkspaceOverrides(
  overrides: SettingsState['workspaceOverrides'] | undefined,
): SettingsState['workspaceOverrides'] {
  if (!overrides) return {}
  return Object.fromEntries(
    Object.entries(overrides).map(([workspaceId, settings]) => [
      workspaceId,
      stripSecretEnvVars(settings),
    ]),
  )
}

function mergeSettings(settings: PersistedSettings | undefined): Settings {
  const sanitized = stripSecretEnvVars(settings ?? {})
  return {
    ...DEFAULT_SETTINGS,
    ...sanitized,
    agent: { ...DEFAULT_SETTINGS.agent, ...sanitized.agent },
    model: { ...DEFAULT_SETTINGS.model, ...sanitized.model },
    voice: { ...DEFAULT_SETTINGS.voice, ...sanitized.voice },
    git: { ...DEFAULT_SETTINGS.git, ...sanitized.git },
    appearance: { ...DEFAULT_SETTINGS.appearance, ...sanitized.appearance },
    cards: { ...DEFAULT_SETTINGS.cards, ...sanitized.cards },
    terminal: { ...DEFAULT_SETTINGS.terminal, ...sanitized.terminal },
    panel: { ...DEFAULT_SETTINGS.panel, ...sanitized.panel },
    gestures: { ...DEFAULT_SETTINGS.gestures, ...sanitized.gestures },
    advanced: { ...DEFAULT_SETTINGS.advanced, ...sanitized.advanced },
    workspaceDefaults: { ...DEFAULT_SETTINGS.workspaceDefaults, ...sanitized.workspaceDefaults },
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
            terminal: { ...global.terminal, ...overrides.terminal },
            panel: { ...global.panel, ...overrides.panel },
            gestures: { ...global.gestures, ...overrides.gestures },
            advanced: { ...global.advanced, ...overrides.advanced },
            workspaceDefaults: { ...global.workspaceDefaults, ...overrides.workspaceDefaults },
          } as Settings
        },

        resetToDefaults: () => {
          set({ global: DEFAULT_SETTINGS, workspaceOverrides: {} })
        },
      }),
      {
        name: 'bento-settings',
        partialize: (state) => ({
          global: stripSecretEnvVars(state.global),
          workspaceOverrides: sanitizeWorkspaceOverrides(state.workspaceOverrides),
        }),
        merge: (persistedState, currentState) => {
          const persisted = persistedState as PersistedSettingsState | undefined
          return {
            ...currentState,
            ...persisted,
            global: mergeSettings(persisted?.global),
            workspaceOverrides: sanitizeWorkspaceOverrides(persisted?.workspaceOverrides ?? currentState.workspaceOverrides),
          }
        },
      },
    ),
    { name: 'settings-store' },
  ),
)

// Register with panel coordination (no circular import)
registerSettingsClose(() => { useSettingsStore.getState().closeSettings() })
