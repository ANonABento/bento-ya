/**
 * Hook for handling pipeline spawn events.
 * Subscribes to backend spawn events and calls the appropriate fire trigger functions.
 */

import { useEffect, useRef, useCallback } from 'react'
import * as ipc from '@/lib/ipc'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useTaskStore } from '@/stores/task-store'
import { useSettingsStore } from '@/stores/settings-store'

type UsePipelineEventsOptions = {
  enabled?: boolean
  onError?: (error: string, taskId: string) => void
  onTriggerStart?: (taskId: string, triggerType: string) => void
  onTriggerComplete?: (taskId: string, success: boolean) => void
}

export function usePipelineEvents({
  enabled = true,
  onError,
  onTriggerStart,
  onTriggerComplete,
}: UsePipelineEventsOptions = {}) {
  const unlistenRefs = useRef<Array<() => void>>([])
  const workspaces = useWorkspaceStore((s) => s.workspaces)
  const updateTask = useTaskStore((s) => s.updateTask)
  const settings = useSettingsStore((s) => s.global)

  // Get CLI path from settings (anthropic provider)
  const cliPath = settings.model.providers.find((p) => p.id === 'anthropic')?.cliPath ?? 'claude'

  // Helper to get workspace repo path
  const getWorkspacePath = useCallback(
    (workspaceId: string): string => {
      const ws = workspaces.find((w) => w.id === workspaceId)
      return ws?.repoPath ?? '/tmp'
    },
    [workspaces]
  )

  // Handle agent spawn event
  const handleSpawnAgent = useCallback(
    async (event: ipc.SpawnAgentEvent) => {
      const { taskId, workspaceId, agentType } = event
      const workingDir = getWorkspacePath(workspaceId)

      onTriggerStart?.(taskId, 'agent')

      try {
        const envVars = { WORKING_DIR: workingDir }
        const task = await ipc.fireAgentTrigger(taskId, agentType, envVars, cliPath)
        updateTask(task.id, task)
        onTriggerComplete?.(taskId, true)
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        onError?.(errorMsg, taskId)
        onTriggerComplete?.(taskId, false)
        // Set pipeline error state
        try {
          await ipc.setPipelineError(taskId, errorMsg)
        } catch {
          // Ignore error setting error state
        }
      }
    },
    [getWorkspacePath, cliPath, updateTask, onError, onTriggerStart, onTriggerComplete]
  )

  // Handle script spawn event
  const handleSpawnScript = useCallback(
    async (event: ipc.SpawnScriptEvent) => {
      const { taskId, scriptPath } = event

      onTriggerStart?.(taskId, 'script')

      try {
        const task = await ipc.fireScriptTrigger(taskId, scriptPath)
        updateTask(task.id, task)
        onTriggerComplete?.(taskId, true)
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        onError?.(errorMsg, taskId)
        onTriggerComplete?.(taskId, false)
        try {
          await ipc.setPipelineError(taskId, errorMsg)
        } catch {
          // Ignore error setting error state
        }
      }
    },
    [updateTask, onError, onTriggerStart, onTriggerComplete]
  )

  // Handle skill spawn event
  const handleSpawnSkill = useCallback(
    async (event: ipc.SpawnSkillEvent) => {
      const { taskId, workspaceId, skillName } = event
      const workingDir = getWorkspacePath(workspaceId)

      onTriggerStart?.(taskId, 'skill')

      try {
        const envVars = { WORKING_DIR: workingDir }
        const task = await ipc.fireSkillTrigger(taskId, skillName, envVars, cliPath)
        updateTask(task.id, task)
        onTriggerComplete?.(taskId, true)
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err)
        onError?.(errorMsg, taskId)
        onTriggerComplete?.(taskId, false)
        try {
          await ipc.setPipelineError(taskId, errorMsg)
        } catch {
          // Ignore error setting error state
        }
      }
    },
    [getWorkspacePath, cliPath, updateTask, onError, onTriggerStart, onTriggerComplete]
  )

  // Subscribe to events on mount
  useEffect(() => {
    if (!enabled) return

    const setupListeners = async () => {
      try {
        const unlistenAgent = await ipc.onPipelineSpawnAgent((payload) => {
          void handleSpawnAgent(payload)
        })
        const unlistenScript = await ipc.onPipelineSpawnScript((payload) => {
          void handleSpawnScript(payload)
        })
        const unlistenSkill = await ipc.onPipelineSpawnSkill((payload) => {
          void handleSpawnSkill(payload)
        })

        unlistenRefs.current = [unlistenAgent, unlistenScript, unlistenSkill]
      } catch (err) {
        console.error('Failed to setup pipeline event listeners:', err)
      }
    }

    void setupListeners()

    return () => {
      unlistenRefs.current.forEach((unlisten) => { unlisten(); })
      unlistenRefs.current = []
    }
  }, [enabled, handleSpawnAgent, handleSpawnScript, handleSpawnSkill])

  return {
    // Expose manual trigger functions if needed
    fireAgentTrigger: handleSpawnAgent,
    fireScriptTrigger: handleSpawnScript,
    fireSkillTrigger: handleSpawnSkill,
  }
}
