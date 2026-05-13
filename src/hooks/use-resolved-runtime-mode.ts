/**
 * Resolve the runtime mode for a task (Phase 2).
 *
 * Wraps the `resolve_runtime_mode` backend command and re-fetches when
 * the `tasks:changed` event fires — keeps the agent panel's dispatcher
 * in sync with column trigger config changes without a full reload.
 */

import { useEffect, useState } from 'react'
import { listen } from '@/lib/ipc'
import { resolveRuntimeMode, type ResolvedRuntimeMode } from '@/lib/ipc/agent-interactive'

export type UseResolvedRuntimeModeResult = ResolvedRuntimeMode & {
  isLoading: boolean
  error: string | null
}

const HEADLESS_BUBBLES_FALLBACK: ResolvedRuntimeMode = {
  mode: 'headless',
  render: 'bubbles',
  source: 'default',
  interactiveDevFlagRequired: false,
}

export function useResolvedRuntimeMode(taskId: string | null): UseResolvedRuntimeModeResult {
  const [resolved, setResolved] = useState<ResolvedRuntimeMode>(HEADLESS_BUBBLES_FALLBACK)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!taskId) {
      setResolved(HEADLESS_BUBBLES_FALLBACK)
      setIsLoading(false)
      setError(null)
      return
    }

    let cancelled = false
    setIsLoading(true)
    setError(null)

    const fetch = async () => {
      try {
        const next = await resolveRuntimeMode(taskId)
        if (cancelled) return
        setResolved(next)
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : String(err)
        setError(message)
        // Fail safe: default to headless bubbles so the existing UI still works.
        setResolved(HEADLESS_BUBBLES_FALLBACK)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void fetch()

    // Re-fetch on tasks:changed — column trigger config edits flow
    // through the same event channel and can flip the resolution.
    const unlistenPromise = listen<unknown>('tasks:changed', () => {
      if (cancelled) return
      void fetch()
    })

    return () => {
      cancelled = true
      void unlistenPromise.then((unlisten) => { unlisten() })
    }
  }, [taskId])

  return { ...resolved, isLoading, error }
}
