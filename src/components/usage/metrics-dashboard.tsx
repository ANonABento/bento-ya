import { useState, useEffect, useMemo } from 'react'
import { motion } from 'motion/react'
import { getWorkspaceUsage, getWorkspaceUsageSummary, type UsageSummary, type UsageRecord } from '@/lib/ipc'

type Props = {
  workspaceId: string
  onClose: () => void
}

function formatCost(usd: number): string {
  if (usd < 0.01) return '<$0.01'
  return `$${usd.toFixed(2)}`
}

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`
  return String(count)
}

function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

type ModelStats = {
  model: string
  cost: number
  inputTokens: number
  outputTokens: number
  count: number
}

type DailyStats = {
  date: string
  cost: number
  tokens: number
}

export function MetricsDashboard({ workspaceId, onClose }: Props) {
  const [summary, setSummary] = useState<UsageSummary | null>(null)
  const [records, setRecords] = useState<UsageRecord[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      setIsLoading(true)
      try {
        const [summaryData, recordsData] = await Promise.all([
          getWorkspaceUsageSummary(workspaceId),
          getWorkspaceUsage(workspaceId, 500),
        ])
        setSummary(summaryData)
        setRecords(recordsData)
      } catch {
        // Ignore errors
      } finally {
        setIsLoading(false)
      }
    }
    void load()
  }, [workspaceId])

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

  const dailyStats = useMemo((): DailyStats[] => {
    const map = new Map<string, DailyStats>()
    for (const r of records) {
      const date = r.createdAt.split('T')[0] ?? r.createdAt
      const existing = map.get(date) ?? { date, cost: 0, tokens: 0 }
      existing.cost += r.costUsd
      existing.tokens += r.inputTokens + r.outputTokens
      map.set(date, existing)
    }
    return Array.from(map.values())
      .sort((a, b) => a.date.localeCompare(b.date))
      .slice(-14)
  }, [records])

  const maxDailyCost = Math.max(...dailyStats.map((d) => d.cost), 0.01)
  const maxModelCost = Math.max(...modelStats.map((m) => m.cost), 0.01)

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
          <h2 className="text-xl font-semibold text-text-primary">Usage Metrics</h2>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-text-secondary transition-colors hover:bg-bg hover:text-text-primary"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>

        <div className="max-h-[calc(85vh-72px)] overflow-y-auto p-6">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <span className="text-text-secondary">Loading metrics...</span>
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
            <div className="space-y-8">
              {/* Summary Cards */}
              <div className="grid grid-cols-4 gap-4">
                <div className="rounded-xl bg-bg p-4">
                  <div className="text-2xl font-bold text-accent">{formatCost(summary.totalCostUsd)}</div>
                  <div className="mt-1 text-sm text-text-secondary">Total Cost</div>
                </div>
                <div className="rounded-xl bg-bg p-4">
                  <div className="text-2xl font-bold text-text-primary">{formatTokens(summary.totalInputTokens)}</div>
                  <div className="mt-1 text-sm text-text-secondary">Input Tokens</div>
                </div>
                <div className="rounded-xl bg-bg p-4">
                  <div className="text-2xl font-bold text-text-primary">{formatTokens(summary.totalOutputTokens)}</div>
                  <div className="mt-1 text-sm text-text-secondary">Output Tokens</div>
                </div>
                <div className="rounded-xl bg-bg p-4">
                  <div className="text-2xl font-bold text-text-primary">{summary.recordCount}</div>
                  <div className="mt-1 text-sm text-text-secondary">API Calls</div>
                </div>
              </div>

              {/* Daily Cost Chart */}
              {dailyStats.length > 0 && (
                <div className="rounded-xl border border-border-default bg-bg p-4">
                  <h3 className="mb-4 font-semibold text-text-primary">Daily Costs (Last 14 Days)</h3>
                  <div className="flex h-32 items-end gap-1">
                    {dailyStats.map((day) => (
                      <div
                        key={day.date}
                        className="group relative flex flex-1 flex-col items-center"
                      >
                        <div className="absolute -top-8 hidden rounded bg-surface px-2 py-1 text-xs shadow-lg group-hover:block">
                          {formatCost(day.cost)}
                        </div>
                        <div
                          className="w-full rounded-t bg-accent transition-all hover:bg-accent/80"
                          style={{ height: `${(day.cost / maxDailyCost) * 100}%`, minHeight: day.cost > 0 ? '4px' : '0' }}
                        />
                        <div className="mt-1 text-[10px] text-text-secondary">{formatDate(day.date)}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Model Breakdown */}
              {modelStats.length > 0 && (
                <div className="rounded-xl border border-border-default bg-bg p-4">
                  <h3 className="mb-4 font-semibold text-text-primary">Cost by Model</h3>
                  <div className="space-y-3">
                    {modelStats.map((model) => (
                      <div key={model.model} className="space-y-1">
                        <div className="flex items-center justify-between text-sm">
                          <span className="font-mono text-text-primary">{model.model.split('/').pop()}</span>
                          <span className="text-text-secondary">
                            {formatCost(model.cost)} ({model.count} calls)
                          </span>
                        </div>
                        <div className="h-2 rounded-full bg-surface">
                          <div
                            className="h-full rounded-full bg-accent"
                            style={{ width: `${(model.cost / maxModelCost) * 100}%` }}
                          />
                        </div>
                        <div className="flex gap-4 text-xs text-text-secondary">
                          <span>In: {formatTokens(model.inputTokens)}</span>
                          <span>Out: {formatTokens(model.outputTokens)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recent Records Table */}
              <div className="rounded-xl border border-border-default bg-bg p-4">
                <h3 className="mb-4 font-semibold text-text-primary">Recent API Calls</h3>
                <div className="max-h-64 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="border-b border-border-default text-left text-text-secondary">
                      <tr>
                        <th className="pb-2 font-medium">Model</th>
                        <th className="pb-2 font-medium">Input</th>
                        <th className="pb-2 font-medium">Output</th>
                        <th className="pb-2 text-right font-medium">Cost</th>
                        <th className="pb-2 text-right font-medium">Time</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border-default">
                      {records.slice(0, 50).map((record) => (
                        <tr key={record.id} className="text-text-primary">
                          <td className="py-2 font-mono text-xs">{record.model.split('/').pop()}</td>
                          <td className="py-2">{formatTokens(record.inputTokens)}</td>
                          <td className="py-2">{formatTokens(record.outputTokens)}</td>
                          <td className="py-2 text-right text-accent">{formatCost(record.costUsd)}</td>
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
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}
