import { create } from 'zustand'
import { devtools } from 'zustand/middleware'
import { getColumnMetrics, type ColumnMetrics } from '@/lib/ipc/pipeline'

type ColumnMetricsState = {
  metricsById: Record<string, ColumnMetrics>
  loadedWorkspaceId: string | null
  load: (workspaceId: string) => Promise<void>
  getMetrics: (columnId: string) => ColumnMetrics | undefined
}

export const useColumnMetricsStore = create<ColumnMetricsState>()(
  devtools(
    (set, get) => ({
      metricsById: {},
      loadedWorkspaceId: null,

      load: async (workspaceId) => {
        const metrics = await getColumnMetrics(workspaceId)
        const metricsById: Record<string, ColumnMetrics> = {}
        for (const m of metrics) {
          metricsById[m.columnId] = m
        }
        set({ metricsById, loadedWorkspaceId: workspaceId })
      },

      getMetrics: (columnId) => get().metricsById[columnId],
    }),
    { name: 'column-metrics-store' },
  ),
)
