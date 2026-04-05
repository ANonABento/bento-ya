import { useCallback, useState } from 'react'
import type { Task } from '@/types'
import * as ipc from '@/lib/ipc'

type SiegeStatusProps = {
  task: Task
  onUpdate: (taskId: string, updates: Partial<Task>) => void
}

export function SiegeStatus({ task, onUpdate }: SiegeStatusProps) {
  const [isLoading, setIsLoading] = useState(false)

  const handleStart = useCallback(async () => {
    setIsLoading(true)
    try {
      const result = await ipc.startSiege(task.id)
      onUpdate(task.id, {
        siegeActive: result.task.siegeActive,
        siegeIteration: result.task.siegeIteration,
        siegeMaxIterations: result.task.siegeMaxIterations,
      })
    } catch (err) {
      console.error('Failed to start siege:', err)
    } finally {
      setIsLoading(false)
    }
  }, [task.id, onUpdate])

  const handleStop = useCallback(async () => {
    setIsLoading(true)
    try {
      const result = await ipc.stopSiege(task.id)
      onUpdate(task.id, {
        siegeActive: result.siegeActive,
        siegeIteration: result.siegeIteration,
      })
    } catch (err) {
      console.error('Failed to stop siege:', err)
    } finally {
      setIsLoading(false)
    }
  }, [task.id, onUpdate])

  const progress = task.siegeMaxIterations > 0
    ? Math.min(100, Math.round((task.siegeIteration / task.siegeMaxIterations) * 100))
    : 0

  return (
    <div className="space-y-2">
      {/* Progress bar */}
      <div className="flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-surface-hover overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${
              task.siegeActive ? 'bg-accent animate-pulse' : 'bg-accent/60'
            }`}
            style={{ width: `${String(progress)}%` }}
          />
        </div>
        <span className="text-[11px] font-mono text-text-secondary tabular-nums">
          {task.siegeIteration}/{task.siegeMaxIterations}
        </span>
      </div>

      {/* Status info */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px]">
          {task.siegeActive ? (
            <>
              <span className="relative flex h-1.5 w-1.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
              </span>
              <span className="text-accent font-medium">Active</span>
            </>
          ) : task.siegeIteration > 0 ? (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-text-secondary/50" />
              <span className="text-text-secondary">Stopped at iteration {task.siegeIteration}</span>
            </>
          ) : (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-text-secondary/50" />
              <span className="text-text-secondary">Not started</span>
            </>
          )}
        </div>

        {/* Start/Stop button */}
        <button
          type="button"
          onClick={() => { void (task.siegeActive ? handleStop() : handleStart()) }}
          disabled={isLoading || !task.prNumber}
          className={`rounded px-2 py-0.5 text-[11px] font-medium transition-colors disabled:opacity-40 ${
            task.siegeActive
              ? 'bg-error/10 text-error hover:bg-error/20'
              : 'bg-accent/10 text-accent hover:bg-accent/20'
          }`}
          title={!task.prNumber ? 'Task needs a PR first' : undefined}
        >
          {isLoading ? '...' : task.siegeActive ? 'Stop' : 'Start'}
        </button>
      </div>

      {/* Last checked */}
      {task.siegeLastChecked && (
        <div className="text-[10px] text-text-secondary/70">
          Last checked: {new Date(task.siegeLastChecked).toLocaleTimeString()}
        </div>
      )}

      {/* No PR warning */}
      {!task.prNumber && (
        <div className="text-[10px] text-amber-500">
          Create a PR first to use the siege loop.
        </div>
      )}
    </div>
  )
}
