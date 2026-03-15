import { useEffect, useRef, useCallback } from 'react'
import { useSettingsStore } from '@/stores/settings-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { updateWorkspaceConfig, getWorkspace } from '@/lib/ipc'
import type { WorkspaceSettings } from '@/types/settings'

const DEBOUNCE_MS = 500

/**
 * Hook that syncs workspace settings to the backend with debouncing.
 *
 * - Loads workspace settings from backend when workspace changes
 * - Saves workspace settings to backend when they change (debounced)
 * - Only syncs workspace-specific settings (agent, git, voice, model)
 * - Appearance and shortcuts remain global-only (localStorage)
 */
export function useSettingsSync() {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const workspaceOverrides = useSettingsStore((s) => s.workspaceOverrides)
  const loadWorkspaceSettings = useSettingsStore((s) => s.loadWorkspaceSettings)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSavedRef = useRef<string | null>(null)

  // Load workspace settings from backend when workspace changes
  useEffect(() => {
    if (!activeWorkspaceId) return

    const loadSettings = async () => {
      try {
        const workspace = await getWorkspace(activeWorkspaceId)
        if (workspace.config && workspace.config !== '{}') {
          const parsed = JSON.parse(workspace.config) as WorkspaceSettings
          // Only update if we have actual settings
          if (Object.keys(parsed).length > 0) {
            loadWorkspaceSettings(activeWorkspaceId, parsed)
            lastSavedRef.current = workspace.config
          }
        }
      } catch (error) {
        console.error('[settings-sync] Failed to load workspace settings:', error)
      }
    }

    void loadSettings()
  }, [activeWorkspaceId, loadWorkspaceSettings])

  // Save workspace settings to backend (debounced)
  const saveSettings = useCallback(async (workspaceId: string, settings: WorkspaceSettings) => {
    // Filter to only workspace-specific settings
    const workspaceSpecificSettings: WorkspaceSettings = {}

    if (settings.agent) workspaceSpecificSettings.agent = settings.agent
    if (settings.git) workspaceSpecificSettings.git = settings.git
    if (settings.voice) workspaceSpecificSettings.voice = settings.voice
    if (settings.model) workspaceSpecificSettings.model = settings.model

    // Skip if nothing to save
    if (Object.keys(workspaceSpecificSettings).length === 0) return

    const configJson = JSON.stringify(workspaceSpecificSettings)

    // Skip if unchanged
    if (configJson === lastSavedRef.current) return

    try {
      await updateWorkspaceConfig(workspaceId, configJson)
      lastSavedRef.current = configJson
    } catch (error) {
      console.error('[settings-sync] Failed to save workspace settings:', error)
    }
  }, [])

  // Watch for changes and save with debounce
  useEffect(() => {
    if (!activeWorkspaceId) return

    const currentOverrides = workspaceOverrides[activeWorkspaceId]
    if (!currentOverrides) return

    // Clear existing debounce
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    // Debounce the save
    debounceRef.current = setTimeout(() => {
      void saveSettings(activeWorkspaceId, currentOverrides)
    }, DEBOUNCE_MS)

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [activeWorkspaceId, workspaceOverrides, saveSettings])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [])
}
