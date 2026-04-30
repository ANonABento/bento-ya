import { useCallback, useEffect, useRef, useState } from 'react'
import { getCostDashboard, type CostDashboard } from '@/lib/ipc'

type UseCostDashboardOptions = {
  enabled?: boolean
}

type UseCostDashboardResult = {
  dashboard: CostDashboard | null
  isLoading: boolean
  error: string | null
  refresh: () => Promise<void>
}

export function useCostDashboard({
  enabled = true,
}: UseCostDashboardOptions = {}): UseCostDashboardResult {
  const [dashboard, setDashboard] = useState<CostDashboard | null>(null)
  const [isLoading, setIsLoading] = useState(enabled)
  const [error, setError] = useState<string | null>(null)
  const requestIdRef = useRef(0)

  const refresh = useCallback(async () => {
    const requestId = ++requestIdRef.current
    setIsLoading(true)
    setError(null)

    try {
      const data = await getCostDashboard()
      if (requestId !== requestIdRef.current) return
      setDashboard(data)
    } catch (err) {
      if (requestId !== requestIdRef.current) return
      setError(err instanceof Error ? err.message : 'Failed to load cost dashboard')
    } finally {
      if (requestId === requestIdRef.current) setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    requestIdRef.current += 1
    setError(null)
    setIsLoading(enabled)
    if (!enabled) return
    void refresh()

    return () => {
      requestIdRef.current += 1
    }
  }, [enabled, refresh])

  return { dashboard, isLoading, error, refresh }
}
