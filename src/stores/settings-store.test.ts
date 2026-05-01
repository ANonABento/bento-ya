import { describe, it, expect, beforeEach, vi } from 'vitest'
import { normalizeSettings, useSettingsStore } from './settings-store'
import { DEFAULT_SETTINGS } from '@/types/settings'

// Mock appearance module
vi.mock('@/lib/appearance', () => ({
  applyAppearance: vi.fn(),
}))

import { applyAppearance } from '@/lib/appearance'

const mockApplyAppearance = vi.mocked(applyAppearance)

describe('settings-store', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset store to initial state
    useSettingsStore.setState({
      global: DEFAULT_SETTINGS,
      workspaceOverrides: {},
      isOpen: false,
      activeTab: 'workspace',
    })
  })

  describe('openSettings / closeSettings', () => {
    it('should toggle isOpen state', () => {
      expect(useSettingsStore.getState().isOpen).toBe(false)

      useSettingsStore.getState().openSettings()
      expect(useSettingsStore.getState().isOpen).toBe(true)

      useSettingsStore.getState().closeSettings()
      expect(useSettingsStore.getState().isOpen).toBe(false)
    })
  })

  describe('setActiveTab', () => {
    it('should update activeTab', () => {
      useSettingsStore.getState().setActiveTab('board')
      expect(useSettingsStore.getState().activeTab).toBe('board')
    })
  })

  describe('updateGlobal', () => {
    it('should update global settings', () => {
      const newAppearance = {
        ...DEFAULT_SETTINGS.appearance,
        accentColor: '#FF0000',
      }

      useSettingsStore.getState().updateGlobal('appearance', newAppearance)

      expect(useSettingsStore.getState().global.appearance.accentColor).toBe('#FF0000')
    })

    it('should apply appearance changes to DOM when updating appearance', () => {
      const newAppearance = {
        ...DEFAULT_SETTINGS.appearance,
        theme: 'dark' as const,
      }

      useSettingsStore.getState().updateGlobal('appearance', newAppearance)

      expect(mockApplyAppearance).toHaveBeenCalledWith(newAppearance)
    })

    it('should not apply appearance when updating other settings', () => {
      useSettingsStore.getState().updateGlobal('agent', DEFAULT_SETTINGS.agent)

      expect(mockApplyAppearance).not.toHaveBeenCalled()
    })
  })

  describe('updateWorkspace', () => {
    it('should store workspace-specific settings', () => {
      useSettingsStore.getState().updateWorkspace('ws-1', {
        agent: { ...DEFAULT_SETTINGS.agent, maxConcurrentAgents: 5 },
      })

      const overrides = useSettingsStore.getState().workspaceOverrides['ws-1']
      expect(overrides?.agent?.maxConcurrentAgents).toBe(5)
    })

    it('should merge with existing workspace settings', () => {
      useSettingsStore.getState().updateWorkspace('ws-1', {
        agent: { ...DEFAULT_SETTINGS.agent, maxConcurrentAgents: 5 },
      })
      useSettingsStore.getState().updateWorkspace('ws-1', {
        git: { ...DEFAULT_SETTINGS.git, autoPr: true },
      })

      const overrides = useSettingsStore.getState().workspaceOverrides['ws-1']
      expect(overrides?.agent?.maxConcurrentAgents).toBe(5)
      expect(overrides?.git?.autoPr).toBe(true)
    })
  })

  describe('loadWorkspaceSettings', () => {
    it('should replace workspace settings entirely', () => {
      useSettingsStore.getState().updateWorkspace('ws-1', {
        agent: { ...DEFAULT_SETTINGS.agent, maxConcurrentAgents: 5 },
        git: { ...DEFAULT_SETTINGS.git, autoPr: true },
      })

      useSettingsStore.getState().loadWorkspaceSettings('ws-1', {
        model: { ...DEFAULT_SETTINGS.model, showCostEstimates: false },
      })

      const overrides = useSettingsStore.getState().workspaceOverrides['ws-1']
      expect(overrides?.model?.showCostEstimates).toBe(false)
      expect(overrides?.agent).toBeUndefined()
    })
  })

  describe('getEffective', () => {
    it('should return global settings when no workspace specified', () => {
      const effective = useSettingsStore.getState().getEffective(null)
      expect(effective).toEqual(DEFAULT_SETTINGS)
    })

    it('should return global settings when workspace has no overrides', () => {
      const effective = useSettingsStore.getState().getEffective('ws-1')
      expect(effective).toEqual(DEFAULT_SETTINGS)
    })

    it('should merge workspace overrides with global settings', () => {
      useSettingsStore.getState().updateWorkspace('ws-1', {
        agent: { ...DEFAULT_SETTINGS.agent, maxConcurrentAgents: 5 },
      })

      const effective = useSettingsStore.getState().getEffective('ws-1')

      expect(effective.agent.maxConcurrentAgents).toBe(5)
      // Other settings should remain from global
      expect(effective.appearance.theme).toBe(DEFAULT_SETTINGS.appearance.theme)
    })

    it('should deep merge nested settings', () => {
      useSettingsStore.getState().updateWorkspace('ws-1', {
        appearance: {
          ...DEFAULT_SETTINGS.appearance,
          accentColor: '#FF0000',
        },
      })

      const effective = useSettingsStore.getState().getEffective('ws-1')

      expect(effective.appearance.accentColor).toBe('#FF0000')
      expect(effective.appearance.theme).toBe(DEFAULT_SETTINGS.appearance.theme)
    })
  })

  describe('normalizeSettings', () => {
    it('fills new nested defaults for older persisted settings', () => {
      const normalized = normalizeSettings({
        model: {
          showCostEstimates: false,
          disabledModels: [],
          providers: DEFAULT_SETTINGS.model.providers,
        },
      } as unknown as Partial<typeof DEFAULT_SETTINGS>)

      expect(normalized.model.showCostEstimates).toBe(false)
      expect(normalized.model.dailyTokenBudgets).toEqual({})
    })
  })

  describe('resetToDefaults', () => {
    it('should reset global settings to defaults', () => {
      useSettingsStore.getState().updateGlobal('appearance', {
        ...DEFAULT_SETTINGS.appearance,
        accentColor: '#FF0000',
      })

      useSettingsStore.getState().resetToDefaults()

      expect(useSettingsStore.getState().global).toEqual(DEFAULT_SETTINGS)
    })

    it('should clear workspace overrides', () => {
      useSettingsStore.getState().updateWorkspace('ws-1', {
        agent: { ...DEFAULT_SETTINGS.agent, maxConcurrentAgents: 5 },
      })

      useSettingsStore.getState().resetToDefaults()

      expect(useSettingsStore.getState().workspaceOverrides).toEqual({})
    })
  })
})
