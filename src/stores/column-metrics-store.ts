import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { getColumnMetrics, type ColumnMetrics } from '@/lib/ipc/pipeline'

type ColumnMetricsState = {
  metricsById: Record<string, ColumnMetrics>
  load: (workspaceId: string) => Promise<void>
}

export const useColumnMetricsStore = create<ColumnMetricsState>()(
  devtools(
    (set) => ({
      metricsById: {},

      load: async (workspaceId) => {
        const metrics = await getColumnMetrics(workspaceId)
        const metricsById: Record<string, ColumnMetrics> = {}
        for (const m of metrics) {
          metricsById[m.columnId] = m
        }
        set({ metricsById })
      },
    }),
    { name: 'column-metrics-store' },
  ),
)
