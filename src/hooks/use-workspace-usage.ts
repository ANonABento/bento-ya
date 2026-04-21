import { useCallback, useEffect, useRef, useState } from 'react'
import { getWorkspaceUsage, getWorkspaceUsageSummary, type UsageRecord, type UsageSummary } from '@/lib/ipc'

type UseWorkspaceUsageOptions = {
  enabled?: boolean
  limit: number
}

type UseWorkspaceUsageResult = {
  summary: UsageSummary | null
  records: UsageRecord[]
  isLoading: boolean
  error: string | null
  refresh: () => Promise<void>
}

export function useWorkspaceUsage(
  workspaceId: string,
  { enabled = true, limit }: UseWorkspaceUsageOptions,
): UseWorkspaceUsageResult {
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [records, setRecords] = useState<UsageRecord[]>([])
  const [isLoading, setIsLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current
    setIsLoading(true)
    setError(null)

    try {
      const [summaryData, recordsData] = await Promise.all([
        getWorkspaceUsageSummary(workspaceId),
        getWorkspaceUsage(workspaceId, limit),
      ])
      if (requestId !== requestIdRef.current) return
      setSummary(summaryData)
      setRecords(recordsData)
    } catch (err) {
      if (requestId !== requestIdRef.current) return
      const message = err instanceof Error ? err.message : 'Failed to load usage'
      setError(message)
    } finally {
      if (requestId === requestIdRef.current) {
        setIsLoading(false)
      }
    }
  }, [limit, workspaceId])

  useEffect(() => {
    requestIdRef.current += 1
    setSummary(null)
    setRecords([])
    setError(null)
    setIsLoading(enabled)
  }, [enabled, workspaceId])

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false)
      return
    }
    void refresh()
  }, [enabled, refresh])

  return {
    summary,
    records,
    isLoading,
    error,
    refresh,
  }
}
