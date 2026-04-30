import { useMemo } from 'react'
import { formatUsageCost, formatUsageTokens } from '@/lib/usage'
import type { UsageByModelSummary } from '@/lib/ipc'

type UsageBudget = Record<string, number>

type UsageWarning = {
  model: string
  budget: number
  used: number
  cost: number
  percent: number
}

type BannerProps = {
  usage: UsageByModelSummary[]
  modelBudgets: UsageBudget
  onDismiss: () => void
  dismissed: Set<string>
}

const DANGER_THRESHOLD = 0.8

export function ModelUsageWarningBanner({
  usage,
  modelBudgets,
  onDismiss,
  dismissed,
}: BannerProps) {
  const warnings = useMemo<UsageWarning[]>(() => {
    return usage
      .map((record): UsageWarning | null => {
        const budget = modelBudgets[record.model] ?? 0
        if (!Number.isFinite(budget) || budget <= 0) return null

        const used = record.totalInputTokens + record.totalOutputTokens
        const percent = used / budget
        if (percent < DANGER_THRESHOLD) return null

        return {
          model: record.model,
          budget,
          used,
          cost: record.totalCostUsd,
          percent,
        }
      })
      .filter((warning): warning is UsageWarning => warning !== null)
      .sort((a, b) => b.percent - a.percent)
  }, [usage, modelBudgets])

  const visibleWarnings = useMemo(
    () => warnings.filter((warning) => !dismissed.has(warning.model)),
    [warnings, dismissed],
  )

  if (visibleWarnings.length === 0) {
    return null
  }

  return (
    <div className="sticky top-0 z-20 border-b border-red-500/30 bg-red-500/10 px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          {visibleWarnings.map((warning) => {
            const pct = Math.min(Math.round(warning.percent * 100), 999)
            return (
              <p key={warning.model} className="text-xs text-red-400">
                <span className="font-medium">Token limit warning:</span>
                {' '}
                <span className="font-mono">{warning.model}</span>
                {' '}exceeded {String(pct)}% of budget
                ({formatUsageTokens(warning.used)}/{formatUsageTokens(warning.budget)} tokens,
                {' '}
                cost {formatUsageCost(warning.cost)}).
              </p>
            )
          })}
        </div>
        <button
          type="button"
          onClick={() => {
            onDismiss()
          }}
          className="rounded-md px-2 py-1 text-xs text-red-200 transition-colors hover:bg-red-500/20"
          aria-label="Dismiss token usage warning"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}
