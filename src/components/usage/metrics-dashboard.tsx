import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'motion/react'
import { useWorkspaceUsage } from '@/hooks/use-workspace-usage'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { formatUsageCost, formatUsageDate, formatUsageTokens } from '@/lib/usage'
import {
  type ColumnCost,
  type DailyCost,
  type TaskCost,
  getWorkspaceColumnCosts,
  getWorkspaceDailyCosts,
  getWorkspaceTaskCosts,
  getWorkspaceUsageSummary,
} from '@/lib/ipc/usage'

type Props = {
  workspaceId: string
  onClose: () => void
}

type ModelStats = {
  model: string
  cost: number
  inputTokens: number
  outputTokens: number
  count: number
}

type WorkspaceCost = {
  workspaceId: string
  workspaceName: string
  totalCostUsd: number
  totalInputTokens: number
  totalOutputTokens: number
  recordCount: number
}

type ActiveTab = 'overview' | 'model' | 'column' | 'task' | 'workspace'

const DAYS = 30
const TOP_TASKS_LIMIT = 10
const RECENT_RECORDS_LIMIT = 50

const TABS: { id: ActiveTab; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'model', label: 'By Model' },
  { id: 'column', label: 'By Column' },
  { id: 'task', label: 'By Task' },
  { id: 'workspace', label: 'All Workspaces' },
]

function shortModelName(model: string): string {
  return model.split('/').pop() ?? model
}

export function MetricsDashboard({ workspaceId, onClose }: Props) {
  const { summary, records, isLoading, error } = useWorkspaceUsage(workspaceId, {
    limit: 1000,
  })
  const allWorkspaces = useWorkspaceStore((s) => s.workspaces)

  const [dailyCosts, setDailyCosts] = useState<DailyCost[]>([])
  const [columnCosts, setColumnCosts] = useState<ColumnCost[]>([])
  const [taskCosts, setTaskCosts] = useState<TaskCost[]>([])
  const [workspaceCosts, setWorkspaceCosts] = useState<WorkspaceCost[]>([])
  const [workspaceCostsLoading, setWorkspaceCostsLoading] = useState(false)
  const [activeTab, setActiveTab] = useState<ActiveTab>('overview')

  useEffect(() => {
    void getWorkspaceDailyCosts(workspaceId, DAYS).then(setDailyCosts)
    void getWorkspaceColumnCosts(workspaceId).then(setColumnCosts)
    void getWorkspaceTaskCosts(workspaceId, TOP_TASKS_LIMIT).then(setTaskCosts)
  }, [workspaceId])

  useEffect(() => {
    if (allWorkspaces.length === 0) return
    let cancelled = false
    setWorkspaceCostsLoading(true)
    void Promise.all(
      allWorkspaces.map(async (ws) => {
        const s = await getWorkspaceUsageSummary(ws.id)
        return {
          workspaceId: ws.id,
          workspaceName: ws.name,
          totalCostUsd: s.totalCostUsd,
          totalInputTokens: s.totalInputTokens,
          totalOutputTokens: s.totalOutputTokens,
          recordCount: s.recordCount,
        } satisfies WorkspaceCost
      }),
    ).then((costs) => {
      if (cancelled) return
      setWorkspaceCosts(costs.sort((a, b) => b.totalCostUsd - a.totalCostUsd))
    }).catch(() => {
      // non-critical: workspace cost summaries will just remain empty
    }).finally(() => {
      if (!cancelled) setWorkspaceCostsLoading(false)
    })
    return () => { cancelled = true }
  }, [allWorkspaces])

  const modelStats = useMemo((): ModelStats[] => {
    const map = new Map<string, ModelStats>()
    for (const r of records) {
      const existing = map.get(r.model) ?? {
        model: r.model,
        cost: 0,
        inputTokens: 0,
        outputTokens: 0,
        count: 0,
      }
      existing.cost += r.costUsd
      existing.inputTokens += r.inputTokens
      existing.outputTokens += r.outputTokens
      existing.count += 1
      map.set(r.model, existing)
    }
    return Array.from(map.values()).sort((a, b) => b.cost - a.cost)
  }, [records])

  const maxDailyCost = Math.max(...dailyCosts.map((d) => d.costUsd), 0.01)
  const maxColumnCost = Math.max(...columnCosts.map((c) => c.costUsd), 0.01)
  const maxTaskCost = Math.max(...taskCosts.map((t) => t.costUsd), 0.01)
  const maxModelCost = Math.max(...modelStats.map((m) => m.cost), 0.01)
  const maxWorkspaceCost = Math.max(...workspaceCosts.map((w) => w.totalCostUsd), 0.01)

  const exportCsv = useCallback(() => {
    const csvField = (v: string) => (v.includes(',') || v.includes('"') ? `"${v.replace(/"/g, '""')}"` : v)
    const header = 'Date,Model,Column,Task ID,Input Tokens,Output Tokens,Cost USD\n'
    const rows = records.map((r) => {
      const date = r.createdAt.slice(0, 10)
      const model = csvField(shortModelName(r.model))
      const column = csvField(r.columnName ?? '')
      const taskId = csvField(r.taskId ?? '')
      return `${date},${model},${column},${taskId},${String(r.inputTokens)},${String(r.outputTokens)},${r.costUsd.toFixed(6)}`
    })
    const csv = header + rows.join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `usage-${workspaceId}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }, [records, workspaceId])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        className="max-h-[85vh] w-full max-w-4xl overflow-hidden rounded-2xl border border-border-default bg-surface shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-border-default px-6 py-4">
          <h2 className="text-xl font-semibold text-text-primary">Usage Dashboard</h2>
          <div className="flex items-center gap-2">
            {records.length > 0 && (
              <button
                onClick={exportCsv}
                className="flex items-center gap-1.5 rounded-lg border border-border-default px-3 py-1.5 text-sm text-text-secondary transition-colors hover:bg-bg hover:text-text-primary"
                title="Export CSV"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path d="M10.75 2.75a.75.75 0 0 0-1.5 0v8.614L6.295 8.235a.75.75 0 1 0-1.09 1.03l4.25 4.5a.75.75 0 0 0 1.09 0l4.25-4.5a.75.75 0 0 0-1.09-1.03l-2.955 3.129V2.75Z" />
                  <path d="M3.5 12.75a.75.75 0 0 0-1.5 0v2.5A2.75 2.75 0 0 0 4.75 18h10.5A2.75 2.75 0 0 0 18 15.25v-2.5a.75.75 0 0 0-1.5 0v2.5c0 .69-.56 1.25-1.25 1.25H4.75c-.69 0-1.25-.56-1.25-1.25v-2.5Z" />
                </svg>
                Export CSV
              </button>
            )}
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-text-secondary transition-colors hover:bg-bg hover:text-text-primary"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
              </svg>
            </button>
          </div>
        </div>

        <div className="max-h-[calc(85vh-72px)] overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <span className="text-text-secondary">Loading metrics...</span>
            </div>
          ) : error ? (
            <div className="rounded-xl bg-red-500/10 px-4 py-6 text-sm text-red-400 m-6">
              {error}
            </div>
          ) : !summary || summary.recordCount === 0 ? (
            <div className="flex flex-col items-center justify-center py-20">
              <div className="mb-4 text-5xl">0</div>
              <p className="text-text-secondary">No usage data recorded yet</p>
              <p className="mt-2 text-sm text-text-secondary">
                Usage will be tracked as you interact with AI agents
              </p>
            </div>
          ) : (
            <div className="p-6 space-y-6">
              {/* Summary Cards */}
              <div className="grid grid-cols-4 gap-4">
                <div className="rounded-xl bg-bg p-4">
                  <div className="text-2xl font-bold text-accent">{formatUsageCost(summary.totalCostUsd)}</div>
                  <div className="mt-1 text-sm text-text-secondary">Total Cost</div>
                </div>
                <div className="rounded-xl bg-bg p-4">
                  <div className="text-2xl font-bold text-text-primary">{formatUsageTokens(summary.totalInputTokens)}</div>
                  <div className="mt-1 text-sm text-text-secondary">Input Tokens</div>
                </div>
                <div className="rounded-xl bg-bg p-4">
                  <div className="text-2xl font-bold text-text-primary">{formatUsageTokens(summary.totalOutputTokens)}</div>
                  <div className="mt-1 text-sm text-text-secondary">Output Tokens</div>
                </div>
                <div className="rounded-xl bg-bg p-4">
                  <div className="text-2xl font-bold text-text-primary">{summary.recordCount}</div>
                  <div className="mt-1 text-sm text-text-secondary">API Calls</div>
                </div>
              </div>

              {/* 30-Day Time Series Chart */}
              {dailyCosts.length > 0 && (
                <div className="rounded-xl border border-border-default bg-bg p-4">
                  <h3 className="mb-4 font-semibold text-text-primary">Daily Costs — Last {DAYS} Days</h3>
                  <div className="flex h-32 items-end gap-0.5">
                    {dailyCosts.map((day) => (
                      <div
                        key={day.date}
                        className="group relative flex flex-1 flex-col items-center"
                      >
                        <div className="absolute -top-8 hidden rounded bg-surface px-2 py-1 text-xs shadow-lg group-hover:block whitespace-nowrap z-10">
                          {formatUsageDate(day.date)}: {formatUsageCost(day.costUsd)}
                        </div>
                        <div
                          className="w-full rounded-t bg-accent transition-all hover:bg-accent/80"
                          style={{ height: `${String((day.costUsd / maxDailyCost) * 100)}%`, minHeight: day.costUsd > 0 ? '4px' : '0' }}
                        />
                        {dailyCosts.length <= 14 && (
                          <div className="mt-1 text-[10px] text-text-secondary">{formatUsageDate(day.date)}</div>
                        )}
                      </div>
                    ))}
                  </div>
                  {dailyCosts.length > 14 && (
                    <div className="mt-2 flex justify-between text-[10px] text-text-secondary">
                      <span>{formatUsageDate(dailyCosts[0]?.date ?? '')}</span>
                      <span>{formatUsageDate(dailyCosts[dailyCosts.length - 1]?.date ?? '')}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Tab Navigation */}
              <div className="flex gap-1 rounded-lg bg-bg p-1">
                {TABS.map((tab) => (
                  <button
                    key={tab.id}
                    onClick={() => { setActiveTab(tab.id) }}
                    className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                      activeTab === tab.id
                        ? 'bg-surface text-text-primary shadow-sm'
                        : 'text-text-secondary hover:text-text-primary'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Tab Content */}
              {activeTab === 'overview' && (
                <div className="rounded-xl border border-border-default bg-bg p-4">
                  <h3 className="mb-4 font-semibold text-text-primary">Recent API Calls</h3>
                  <div className="max-h-64 overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b border-border-default text-left text-text-secondary">
                        <tr>
                          <th className="pb-2 font-medium">Model</th>
                          <th className="pb-2 font-medium">Column</th>
                          <th className="pb-2 font-medium">Input</th>
                          <th className="pb-2 font-medium">Output</th>
                          <th className="pb-2 text-right font-medium">Cost</th>
                          <th className="pb-2 text-right font-medium">Time</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border-default">
                        {records.slice(0, RECENT_RECORDS_LIMIT).map((record) => (
                          <tr key={record.id} className="text-text-primary">
                            <td className="py-2 font-mono text-xs">{shortModelName(record.model)}</td>
                            <td className="py-2 text-xs text-text-secondary">{record.columnName ?? '—'}</td>
                            <td className="py-2">{formatUsageTokens(record.inputTokens)}</td>
                            <td className="py-2">{formatUsageTokens(record.outputTokens)}</td>
                            <td className="py-2 text-right text-accent">{formatUsageCost(record.costUsd)}</td>
                            <td className="py-2 text-right text-text-secondary">
                              {new Date(record.createdAt).toLocaleTimeString('en-US', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {activeTab === 'model' && (
                <div className="rounded-xl border border-border-default bg-bg p-4">
                  <h3 className="mb-4 font-semibold text-text-primary">Cost by Model</h3>
                  {modelStats.length === 0 ? (
                    <p className="text-sm text-text-secondary">No model data available</p>
                  ) : (
                    <div className="space-y-3">
                      {modelStats.map((model) => (
                        <div key={model.model} className="space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <span className="font-mono text-text-primary">{shortModelName(model.model)}</span>
                            <span className="text-text-secondary">
                              {formatUsageCost(model.cost)} ({model.count} calls)
                            </span>
                          </div>
                          <div className="h-2 rounded-full bg-surface">
                            <div
                              className="h-full rounded-full bg-accent"
                              style={{ width: `${String((model.cost / maxModelCost) * 100)}%` }}
                            />
                          </div>
                          <div className="flex gap-4 text-xs text-text-secondary">
                            <span>In: {formatUsageTokens(model.inputTokens)}</span>
                            <span>Out: {formatUsageTokens(model.outputTokens)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'column' && (
                <div className="rounded-xl border border-border-default bg-bg p-4">
                  <h3 className="mb-4 font-semibold text-text-primary">Cost by Column</h3>
                  {columnCosts.length === 0 ? (
                    <p className="text-sm text-text-secondary">No column data available</p>
                  ) : (
                    <div className="space-y-3">
                      {columnCosts.map((col) => (
                        <div key={col.columnName} className="space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-text-primary">{col.columnName}</span>
                            <span className="text-text-secondary">
                              {formatUsageCost(col.costUsd)} ({col.recordCount} calls)
                            </span>
                          </div>
                          <div className="h-2 rounded-full bg-surface">
                            <div
                              className="h-full rounded-full bg-blue-500"
                              style={{ width: `${String((col.costUsd / maxColumnCost) * 100)}%` }}
                            />
                          </div>
                          <div className="flex gap-4 text-xs text-text-secondary">
                            <span>In: {formatUsageTokens(col.inputTokens)}</span>
                            <span>Out: {formatUsageTokens(col.outputTokens)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'task' && (
                <div className="rounded-xl border border-border-default bg-bg p-4">
                  <h3 className="mb-4 font-semibold text-text-primary">Top Tasks by Cost</h3>
                  {taskCosts.length === 0 ? (
                    <p className="text-sm text-text-secondary">No task data available</p>
                  ) : (
                    <div className="space-y-3">
                      {taskCosts.map((task) => (
                        <div key={task.taskId} className="space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <span className="text-text-primary truncate max-w-[60%]" title={task.taskTitle}>
                              {task.taskTitle}
                            </span>
                            <span className="text-text-secondary shrink-0 ml-2">
                              {formatUsageCost(task.costUsd)} ({task.recordCount} calls)
                            </span>
                          </div>
                          <div className="h-2 rounded-full bg-surface">
                            <div
                              className="h-full rounded-full bg-purple-500"
                              style={{ width: `${String((task.costUsd / maxTaskCost) * 100)}%` }}
                            />
                          </div>
                          <div className="flex gap-4 text-xs text-text-secondary">
                            <span>In: {formatUsageTokens(task.inputTokens)}</span>
                            <span>Out: {formatUsageTokens(task.outputTokens)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {activeTab === 'workspace' && (
                <div className="rounded-xl border border-border-default bg-bg p-4">
                  <h3 className="mb-4 font-semibold text-text-primary">Cost by Workspace</h3>
                  {workspaceCostsLoading ? (
                    <p className="text-sm text-text-secondary">Loading workspace costs...</p>
                  ) : workspaceCosts.length === 0 ? (
                    <p className="text-sm text-text-secondary">No workspace data available</p>
                  ) : (
                    <div className="space-y-3">
                      {workspaceCosts.map((ws) => (
                        <div key={ws.workspaceId} className="space-y-1">
                          <div className="flex items-center justify-between text-sm">
                            <span className={`font-medium ${ws.workspaceId === workspaceId ? 'text-accent' : 'text-text-primary'}`}>
                              {ws.workspaceName}
                              {ws.workspaceId === workspaceId && (
                                <span className="ml-1.5 text-xs text-text-secondary font-normal">(current)</span>
                              )}
                            </span>
                            <span className="text-text-secondary shrink-0 ml-2">
                              {formatUsageCost(ws.totalCostUsd)} ({ws.recordCount} calls)
                            </span>
                          </div>
                          <div className="h-2 rounded-full bg-surface">
                            <div
                              className="h-full rounded-full bg-emerald-500"
                              style={{ width: `${String((ws.totalCostUsd / maxWorkspaceCost) * 100)}%` }}
                            />
                          </div>
                          <div className="flex gap-4 text-xs text-text-secondary">
                            <span>In: {formatUsageTokens(ws.totalInputTokens)}</span>
                            <span>Out: {formatUsageTokens(ws.totalOutputTokens)}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}
