import { useEffect, useMemo, useState } from 'react'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { getWorkspaceUsage, type UsageRecord } from '@/lib/ipc/usage'
import type { ModelTier } from '@/lib/ipc/models'
import {
  aggregateUsageByModel,
  buildModelUsageIndex,
  EMPTY_USAGE_STATS,
} from '@/lib/model-usage'
import {
  formatPricePerMillion,
  formatTokenLimit,
  formatUsageCost,
  formatUsageTokens,
} from '@/lib/usage-format'

export type ComparableModel = {
  providerId: string
  providerName: string
  id: string
  displayName: string
  alias: string | null
  tier: ModelTier
  contextWindow: number
  maxOutputTokens: number
  inputCostPerM: number | null
  outputCostPerM: number | null
  capabilities: string[]
  isNew: boolean
}

const STORAGE_KEY = 'agent-tab-model-comparison-collapsed'

type Props = {
  models: ComparableModel[]
}

export function ModelComparisonSection({ models }: Props) {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const [collapsed, setCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      return saved === null ? true : saved === 'true'
    } catch {
      return true
    }
  })
  const [records, setRecords] = useState<UsageRecord[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [hasUsageError, setHasUsageError] = useState(false)
  const modelCount = models.length

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(collapsed))
    } catch {
      // Ignore storage failures; the section still works without persistence.
    }
  }, [collapsed])

  useEffect(() => {
    if (collapsed) return

    if (modelCount === 0) {
      setRecords([])
      setIsLoading(false)
      setHasUsageError(false)
      return
    }

    if (!activeWorkspaceId) {
      setRecords([])
      setIsLoading(false)
      setHasUsageError(false)
      return
    }

    let cancelled = false
    setIsLoading(true)
    setHasUsageError(false)

    getWorkspaceUsage(activeWorkspaceId, 500)
      .then((usageRecords) => {
        if (!cancelled) setRecords(usageRecords)
      })
      .catch(() => {
        if (!cancelled) {
          setRecords([])
          setHasUsageError(true)
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [activeWorkspaceId, collapsed, modelCount])

  const usageIndex = useMemo(() => buildModelUsageIndex(models), [models])
  const usageByModel = useMemo(
    () => aggregateUsageByModel(records, usageIndex),
    [records, usageIndex],
  )

  return (
    <section className="border-t border-border-default pt-6">
      <button
        type="button"
        onClick={() => {
          setCollapsed((value) => !value)
        }}
        className="mb-4 flex w-full items-center justify-between text-left"
        style={{ cursor: 'pointer' }}
        aria-expanded={!collapsed}
      >
        <div style={{ cursor: 'inherit' }}>
          <h3 className="text-sm font-medium text-text-primary" style={{ cursor: 'inherit' }}>
            Model Comparison
          </h3>
          <p className="mt-1 text-xs text-text-secondary" style={{ cursor: 'inherit' }}>
            {modelCount === 1 ? '1 enabled model' : `${String(modelCount)} enabled models`}
          </p>
        </div>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
          className={`h-4 w-4 text-text-secondary transition-transform ${collapsed ? '' : 'rotate-180'}`}
          style={{ cursor: 'inherit' }}
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {!collapsed && (
        <div className="space-y-3">
          {modelCount === 0 ? (
            <p className="rounded-lg border border-border-default px-3 py-4 text-sm text-text-secondary">
              Enable a provider to compare available models.
            </p>
          ) : (
            <>
              <UsageState
                activeWorkspaceId={activeWorkspaceId}
                isLoading={isLoading}
                hasUsageError={hasUsageError}
                recordCount={records.length}
              />
              <div className="overflow-x-auto rounded-lg border border-border-default">
                <table className="w-full min-w-[980px] text-left text-xs">
                  <thead className="border-b border-border-default bg-surface-hover/40 text-text-secondary">
                    <tr>
                      <th className="px-3 py-2 font-medium">Provider</th>
                      <th className="px-3 py-2 font-medium">Model</th>
                      <th className="px-3 py-2 font-medium">Tier</th>
                      <th className="px-3 py-2 text-right font-medium">Input / 1M</th>
                      <th className="px-3 py-2 text-right font-medium">Output / 1M</th>
                      <th className="px-3 py-2 text-right font-medium">Context</th>
                      <th className="px-3 py-2 text-right font-medium">Max output</th>
                      <th className="px-3 py-2 font-medium">Capabilities</th>
                      <th className="px-3 py-2 text-right font-medium">Calls</th>
                      <th className="px-3 py-2 text-right font-medium">Tokens</th>
                      <th className="px-3 py-2 text-right font-medium">Spend</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-default">
                    {models.map((model) => {
                      const usage = usageByModel[`${model.providerId}:${model.id}`] ?? EMPTY_USAGE_STATS

                      return (
                        <tr
                          key={`${model.providerId}:${model.id}`}
                          className="text-text-primary"
                        >
                          <td className="px-3 py-3 text-text-secondary">{model.providerName}</td>
                          <td className="px-3 py-3">
                            <div className="flex flex-wrap items-center gap-1.5 font-medium">
                              <span>{model.displayName}</span>
                              {model.isNew && (
                                <span className="rounded bg-accent/20 px-1 py-0.5 text-[10px] font-medium text-accent">
                                  New
                                </span>
                              )}
                            </div>
                            <div
                              className="mt-0.5 max-w-48 truncate font-mono text-[11px] text-text-secondary"
                              title={model.id}
                            >
                              {model.id}
                            </div>
                            {model.alias && (
                              <div className="mt-1 font-mono text-[11px] text-text-secondary">
                                alias: {model.alias}
                              </div>
                            )}
                          </td>
                          <td className="px-3 py-3 capitalize text-text-secondary">
                            {model.tier}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-text-secondary">
                            {formatPricePerMillion(model.inputCostPerM)}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-text-secondary">
                            {formatPricePerMillion(model.outputCostPerM)}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-text-secondary">
                            {formatTokenLimit(model.contextWindow)}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-text-secondary">
                            {formatTokenLimit(model.maxOutputTokens)}
                          </td>
                          <td className="px-3 py-3">
                            <CapabilityBadges capabilities={model.capabilities} />
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-text-secondary">
                            {usage.calls}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-text-secondary">
                            {formatUsageTokens(usage.totalTokens)}
                          </td>
                          <td className="px-3 py-3 text-right tabular-nums text-accent">
                            {formatUsageCost(usage.costUsd)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}

function UsageState({
  activeWorkspaceId,
  isLoading,
  hasUsageError,
  recordCount,
}: {
  activeWorkspaceId: string | null
  isLoading: boolean
  hasUsageError: boolean
  recordCount: number
}) {
  if (!activeWorkspaceId) {
    return (
      <p className="text-xs text-text-secondary">Select a workspace to include usage totals.</p>
    )
  }

  if (isLoading) {
    return <p className="text-xs text-text-secondary">Loading workspace usage...</p>
  }

  if (hasUsageError) {
    return <p className="text-xs text-yellow-500">Usage data is unavailable right now.</p>
  }

  if (recordCount === 0) {
    return <p className="text-xs text-text-secondary">No usage records in this workspace yet.</p>
  }

  return (
    <p className="text-xs text-text-secondary">
      Usage totals are based on the latest {String(recordCount)} records for this workspace.
    </p>
  )
}

function CapabilityBadges({ capabilities }: { capabilities: string[] }) {
  if (capabilities.length === 0) {
    return <span className="text-text-secondary">--</span>
  }

  return (
    <div className="flex max-w-56 flex-wrap gap-1">
      {capabilities.map((capability) => (
        <span
          key={capability}
          className="rounded border border-border-default bg-surface px-1.5 py-0.5 text-[11px] capitalize text-text-secondary"
        >
          {capability}
        </span>
      ))}
    </div>
  )
}
