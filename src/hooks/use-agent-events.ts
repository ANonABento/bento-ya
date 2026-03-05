/**
 * Global agent event listener that updates task status when agent events occur.
 * Mount this at the app level to keep task cards in sync with agent status.
 */
import { useEffect } from 'react'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { useTaskStore } from '@/stores/task-store'
import type { AgentStatusPayload } from '@/lib/ipc'

export function useAgentEvents() {
  const updateTask = useTaskStore((s) => s.updateTask)

  useEffect(() => {
    const unsubscribes: UnlistenFn[] = []

    const setupListeners = async () => {
      // Agent started processing
      const unsubProcessing = await listen<AgentStatusPayload>('agent:processing', (event) => {
        void updateTask(event.payload.taskId, { agentStatus: 'running' })
      })
      unsubscribes.push(unsubProcessing)

      // Agent completed successfully
      const unsubComplete = await listen<AgentStatusPayload>('agent:complete', (event) => {
        // Mark as completed - we could also set to 'stopped' if we want to differentiate
        void updateTask(event.payload.taskId, { agentStatus: 'completed' })
      })
      unsubscribes.push(unsubComplete)

      // Agent error
      const unsubError = await listen<AgentStatusPayload>('agent:error', (event) => {
        void updateTask(event.payload.taskId, {
          agentStatus: 'failed',
          pipelineError: event.payload.message ?? 'Agent error',
        })
      })
      unsubscribes.push(unsubError)
    }

    void setupListeners()

    return () => {
      for (const unsub of unsubscribes) {
        unsub()
      }
    }
  }, [updateTask])
}
