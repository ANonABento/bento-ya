import { useCallback } from 'react'
import type { Task } from '@/types'
import { useTaskStore } from '@/stores/task-store'
import * as ipc from '@/lib/ipc'

/** Encapsulates all task card action handlers (context menu, keyboard, quick actions). */
export function useTaskCardActions(task: Task) {
  const moveTask = useTaskStore((s) => s.move)
  const removeTask = useTaskStore((s) => s.remove)
  const updateTask = useTaskStore((s) => s.updateTask)
  const duplicateTask = useTaskStore((s) => s.duplicate)

  const handleMoveToColumn = useCallback((columnId: string) => {
    void moveTask(task.id, columnId, 0)
  }, [task.id, moveTask])

  const handleRunAgent = useCallback(() => {
    updateTask(task.id, { agentStatus: 'running' })
  }, [task.id, updateTask])

  const handleStopAgent = useCallback(() => {
    updateTask(task.id, { agentStatus: 'stopped' })
  }, [task.id, updateTask])

  const handleStartSiege = useCallback(async () => {
    try {
      const result = await ipc.startSiege(task.id)
      updateTask(task.id, {
        siegeActive: result.task.siegeActive,
        siegeIteration: result.task.siegeIteration,
        siegeMaxIterations: result.task.siegeMaxIterations,
      })
    } catch (err) {
      console.error('Failed to start siege:', err)
    }
  }, [task.id, updateTask])

  const handleStopSiege = useCallback(async () => {
    try {
      const result = await ipc.stopSiege(task.id)
      updateTask(task.id, {
        siegeActive: result.siegeActive,
        siegeIteration: result.siegeIteration,
      })
    } catch (err) {
      console.error('Failed to stop siege:', err)
    }
  }, [task.id, updateTask])

  const handleArchiveTask = useCallback(() => {
    void removeTask(task.id)
  }, [task.id, removeTask])

  const handleDeleteTask = useCallback(() => {
    void removeTask(task.id)
  }, [task.id, removeTask])

  const handleDuplicateTask = useCallback(() => {
    void duplicateTask(task.id)
  }, [task.id, duplicateTask])

  const handleSaveAsTemplate = useCallback(async () => {
    const title = window.prompt('Template title', `${task.title} (template)`)
    if (title === null) return

    const trimmedTitle = title.trim()
    if (!trimmedTitle) return

    try {
      await ipc.saveTaskAsTemplate(task.id, trimmedTitle)
    } catch (err) {
      console.error('Failed to save template:', err)
    }
  }, [task.id, task.title])

  const handleToggleAgent = useCallback(() => {
    if (task.agentStatus === 'running') {
      updateTask(task.id, { agentStatus: 'stopped' })
    } else {
      updateTask(task.id, { agentStatus: 'running' })
    }
  }, [task.id, task.agentStatus, updateTask])

  const handleRetryPipeline = useCallback(async () => {
    try {
      const updated = await ipc.retryPipeline(task.id)
      updateTask(task.id, {
        pipelineState: updated.pipelineState,
        pipelineError: updated.pipelineError,
      })
    } catch (err) {
      console.error('Retry failed:', err)
    }
  }, [task.id, updateTask])

  return {
    updateTask,
    handleMoveToColumn,
    handleRunAgent,
    handleStopAgent,
    handleStartSiege,
    handleStopSiege,
    handleArchiveTask,
    handleDeleteTask,
    handleDuplicateTask,
    handleSaveAsTemplate,
    handleToggleAgent,
    handleRetryPipeline,
  }
}
