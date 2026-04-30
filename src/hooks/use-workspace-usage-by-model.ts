import { useCallback, useEffect, useRef, useState } from 'react'
import { getWorkspaceUsageByModelForDate, type UsageByModelSummary } from '@/lib/ipc'

type UseWorkspaceUsageByModelOptions = {
  enabled?: boolean
  date: string
}

type UseWorkspaceUsageByModelResult = {
  summaries: UsageByModelSummary[]
  isLoading: boolean
  error: string | null
  refresh: () => Promise<void>
}

export function useWorkspaceUsageByModel(
  workspaceId: string,
  { enabled = true, date }: UseWorkspaceUsageByModelOptions,
): UseWorkspaceUsageByModelResult {
  const [summaries, setSummaries] = useState<UsageByModelSummary[]>([])
  const [isLoading, setIsLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  const refresh = useCallback(async () => {
    if (!enabled) return

    const requestId = ++requestIdRef.current
    setIsLoading(true)
    setError(null)

    try {
      const data = await getWorkspaceUsageByModelForDate(workspaceId, date)
      if (requestId !== requestIdRef.current) return
      setSummaries(data)
    } catch (err) {
      if (requestId !== requestIdRef.current) return
      const message = err instanceof Error ? err.message : 'Failed to load usage by model'
      setError(message)
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false)
      }
    }
  }, [date, enabled, workspaceId])

  useEffect(() => {
    requestIdRef.current += 1
    setSummaries([])
    setError(null)
    setIsLoading(enabled)
  }, [enabled, workspaceId, date])

  useEffect(() => {
    if (!enabled || !workspaceId) {
      setIsLoading(false)
      return
    }
    void refresh()
  }, [enabled, workspaceId, refresh])

  return {
    summaries,
    isLoading,
    error,
    refresh,
  }
}
