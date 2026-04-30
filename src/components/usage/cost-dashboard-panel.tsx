import { motion } from 'motion/react'
import { useCostDashboard } from '@/hooks/use-cost-dashboard'
import { formatUsageCost, formatUsageDate, formatUsageTokens } from '@/lib/usage'
import type { DailyCostSummary } from '@/lib/ipc'

type Props = {
  onClose: () => void
}

export function CostDashboardPanel({ onClose }: Props) {
  const { dashboard, isLoading, error, refresh } = useCostDashboard()
  const total = dashboard?.total
  const daily = dashboard?.daily.slice(-30) ?? []
  const maxDailyCost = Math.max(...daily.map((d) => d.totalCostUsd), 0.01)
  const maxWorkspaceCost = Math.max(
    ...(dashboard?.workspaces.map((w) => w.totalCostUsd) ?? []),
    0.01,
  )
  const maxColumnCost = Math.max(
    ...(dashboard?.columns.map((c) => c.totalCostUsd) ?? []),
    0.01,
  )

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <motion.div
        initial={{ scale: 0.97, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.97, opacity: 0 }}
        className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg border border-border-default bg-surface shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border-default px-5 py-3">
          <div>
            <h2 className="text-lg font-semibold text-text-primary">Cost Dashboard</h2>
            <p className="text-xs text-text-secondary">LLM spend by task, column, and workspace</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => { void refresh() }}
              disabled={isLoading}
              className="flex h-8 w-8 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-bg hover:text-text-primary disabled:opacity-50"
              title="Refresh"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className={`h-4 w-4 ${isLoading ? 'animate-spin' : ''}`}
              >
                <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 0 1-9.201 2.466l-.312-.311h2.433a.75.75 0 0 0 0-1.5H3.989a.75.75 0 0 0-.75.75v4.242a.75.75 0 0 0 1.5 0v-2.43l.31.31a7 7 0 0 0 11.712-3.138.75.75 0 0 0-1.449-.39Zm1.23-3.723a.75.75 0 0 0 .219-.53V2.929a.75.75 0 0 0-1.5 0v2.43l-.31-.31A7 7 0 0 0 3.239 8.188a.75.75 0 1 0 1.448.389A5.5 5.5 0 0 1 13.89 6.11l.311.31h-2.432a.75.75 0 0 0 0 1.5h4.243a.75.75 0 0 0 .53-.219Z" clipRule="evenodd" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-bg hover:text-text-primary"
              title="Close"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
              </svg>
            </button>
          </div>
        </div>

        <div className="overflow-y-auto p-5">
          {isLoading ? (
            <StateMessage>Loading cost data...</StateMessage>
          ) : error ? (
            <div className="rounded-lg bg-red-500/10 px-4 py-5 text-sm text-red-400">{error}</div>
          ) : !dashboard || !total || total.recordCount === 0 ? (
            <StateMessage>No usage data recorded yet</StateMessage>
          ) : (
            <div className="space-y-5">
              <div className="grid gap-3 md:grid-cols-4">
                <MetricCard label="Total spend" value={formatUsageCost(total.totalCostUsd)} accent />
                <MetricCard label="Input tokens" value={formatUsageTokens(total.totalInputTokens)} />
                <MetricCard label="Output tokens" value={formatUsageTokens(total.totalOutputTokens)} />
                <MetricCard label="Usage rows" value={String(total.recordCount)} />
              </div>

              <Panel title="Daily Trend">
                <DailyTrend daily={daily} maxCost={maxDailyCost} />
              </Panel>

              <div className="grid gap-5 lg:grid-cols-2">
                <Panel title="Spend Per Workspace">
                  <StackedRows
                    rows={dashboard.workspaces}
                    maxCost={maxWorkspaceCost}
                    getTitle={(row) => row.workspaceName}
                    getSubtitle={(row) => `${formatUsageTokens(row.totalInputTokens + row.totalOutputTokens)} tokens - ${String(row.recordCount)} rows`}
                  />
                </Panel>

                <Panel title="Spend Per Column">
                  <StackedRows
                    rows={dashboard.columns.slice(0, 12)}
                    maxCost={maxColumnCost}
                    getTitle={(row) => row.columnName}
                    getSubtitle={(row) => `${row.workspaceName} - ${String(row.recordCount)} rows`}
                  />
                </Panel>
              </div>

              <Panel title="Top 10 Tasks">
                <div className="overflow-hidden rounded-md border border-border-default">
                  <table className="w-full text-sm">
                    <thead className="bg-bg text-left text-xs text-text-secondary">
                      <tr>
                        <th className="px-3 py-2 font-medium">Task</th>
                        <th className="px-3 py-2 font-medium">Workspace</th>
                        <th className="px-3 py-2 font-medium">Column</th>
                        <th className="px-3 py-2 text-right font-medium">Tokens</th>
                        <th className="px-3 py-2 text-right font-medium">Spend</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-default">
                      {dashboard.topTasks.map((task) => (
                        <tr key={`${task.workspaceId}:${task.taskId ?? task.taskTitle}`} className="text-text-primary">
                          <td className="max-w-80 truncate px-3 py-2">{task.taskTitle}</td>
                          <td className="px-3 py-2 text-text-secondary">{task.workspaceName}</td>
                          <td className="px-3 py-2 text-text-secondary">{task.columnName ?? 'Unassigned'}</td>
                          <td className="px-3 py-2 text-right text-text-secondary">
                            {formatUsageTokens(task.totalInputTokens + task.totalOutputTokens)}
                          </td>
                          <td className="px-3 py-2 text-right font-medium text-accent">
                            {formatUsageCost(task.totalCostUsd)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}

function MetricCard({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-md bg-bg p-4">
      <div className={`text-2xl font-semibold ${accent ? 'text-accent' : 'text-text-primary'}`}>{value}</div>
      <div className="mt-1 text-xs text-text-secondary">{label}</div>
    </div>
  )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold text-text-primary">{title}</h3>
      {children}
    </section>
  )
}

function DailyTrend({ daily, maxCost }: { daily: DailyCostSummary[]; maxCost: number }) {
  if (daily.length === 0) return <StateMessage>No daily usage yet</StateMessage>

  return (
    <div className="flex h-44 items-end gap-1 rounded-md border border-border-default bg-bg p-3">
      {daily.map((day) => (
        <div key={day.date} className="group relative flex h-full min-w-0 flex-1 flex-col justify-end">
          <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded bg-surface px-2 py-1 text-xs text-text-primary shadow-lg group-hover:block">
            {formatUsageDate(day.date)} - {formatUsageCost(day.totalCostUsd)}
          </div>
          <div
            className="min-h-1 rounded-t bg-accent transition-colors group-hover:bg-accent/80"
            style={{ height: `${String((day.totalCostUsd / maxCost) * 100)}%` }}
          />
        </div>
      ))}
    </div>
  )
}

type SpendRow = {
  totalCostUsd: number
}

function StackedRows<T extends SpendRow>({
  rows,
  maxCost,
  getTitle,
  getSubtitle,
}: {
  rows: T[]
  maxCost: number
  getTitle: (row: T) => string
  getSubtitle: (row: T) => string
}) {
  if (rows.length === 0) return <StateMessage>No rows</StateMessage>

  return (
    <div className="space-y-2">
      {rows.map((row, index) => (
        <div key={`${getTitle(row)}:${String(index)}`} className="rounded-md bg-bg p-3">
          <div className="flex items-center justify-between gap-3 text-sm">
            <div className="min-w-0">
              <div className="truncate font-medium text-text-primary">{getTitle(row)}</div>
              <div className="truncate text-xs text-text-secondary">{getSubtitle(row)}</div>
            </div>
            <div className="shrink-0 font-medium text-accent">{formatUsageCost(row.totalCostUsd)}</div>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${String((row.totalCostUsd / maxCost) * 100)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  )
}

function StateMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-40 items-center justify-center rounded-md border border-border-default bg-bg text-sm text-text-secondary">
      {children}
    </div>
  )
}
