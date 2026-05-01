import { useEffect, useMemo, useState } from 'react'
import { useSettingsStore } from '@/stores/settings-store'
import { getWorkspaceUsage, type UsageRecord } from '@/lib/ipc/usage'
import { formatUsageCost, formatUsageTokens } from '@/lib/usage-format'
import {
  buildUsageDismissKey,
  findDailyUsageBudgetWarnings,
  todayLocalDateKey,
} from '@/lib/usage-budget'

type Props = {
  workspaceId: string
}

const USAGE_REFRESH_INTERVAL_MS = 60_000

export function UsageBudgetBanner({ workspaceId }: Props) {
  const budgetsUsd = useSettingsStore((s) => s.global.model.dailyBudgetsUsd ?? {})
  const openSettings = useSettingsStore((s) => s.openSettings)
  const setActiveTab = useSettingsStore((s) => s.setActiveTab)
  const [records, setRecords] = useState<UsageRecord[]>([])
  const [dismissedKeys, setDismissedKeys] = useState<Set<string>>(() => new Set())

  const hasBudgets = useMemo(
    () => Object.values(budgetsUsd).some((budget) => Number.isFinite(budget) && budget > 0),
    [budgetsUsd],
  )

  useEffect(() => {
    setRecords([])
    setDismissedKeys(new Set())
  }, [workspaceId])

  useEffect(() => {
    if (!hasBudgets) {
      setRecords([])
      return
    }

    let cancelled = false

    const loadUsage = () => {
      void getWorkspaceUsage(workspaceId, 2000)
        .then((usageRecords) => {
          if (!cancelled) setRecords(usageRecords)
        })
        .catch(() => {
          if (!cancelled) setRecords([])
        })
    }

    loadUsage()
    const interval = window.setInterval(loadUsage, USAGE_REFRESH_INTERVAL_MS)

    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [hasBudgets, workspaceId])

  const dateKey = todayLocalDateKey()
  const warning = useMemo(() => {
    const warnings = findDailyUsageBudgetWarnings(records, budgetsUsd)
    return warnings.find((candidate) => {
      const dismissKey = buildUsageDismissKey(workspaceId, dateKey, candidate.key)
      if (dismissedKeys.has(dismissKey)) return false

      try {
        return localStorage.getItem(dismissKey) !== 'true'
      } catch {
        return true
      }
    })
  }, [budgetsUsd, dateKey, dismissedKeys, records, workspaceId])

  if (!warning) return null

  const dismissKey = buildUsageDismissKey(workspaceId, dateKey, warning.key)
  const percentage = Math.round(warning.percentage * 100)

  return (
    <div className="sticky top-0 z-30 border-b border-red-500/30 bg-red-950/95 px-4 py-3 text-red-50 shadow-lg">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-red-500/20 text-red-200">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.19-1.458-1.516-2.625L8.485 2.495ZM10 5.75a.75.75 0 0 1 .75.75v3.25a.75.75 0 0 1-1.5 0V6.5A.75.75 0 0 1 10 5.75Zm0 7.75a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
            </svg>
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">
              {warning.displayName} daily budget at {String(percentage)}%
            </p>
            <p className="text-xs text-red-100/85">
              {formatUsageCost(warning.costUsd)} of {formatUsageCost(warning.budgetUsd)} today · {formatUsageTokens(warning.totalTokens)} tokens
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setActiveTab('agent')
              openSettings()
            }}
            className="rounded border border-red-200/30 px-2.5 py-1.5 text-xs font-medium text-red-50 transition-colors hover:bg-red-500/20"
            style={{ cursor: 'pointer' }}
          >
            Settings
          </button>
          <button
            type="button"
            onClick={() => {
              try {
                localStorage.setItem(dismissKey, 'true')
              } catch {
                // Ignore storage failures; local state still hides this banner.
              }
              setDismissedKeys((current) => new Set(current).add(dismissKey))
            }}
            className="rounded p-1.5 text-red-100/80 transition-colors hover:bg-red-500/20 hover:text-red-50"
            aria-label="Dismiss usage budget warning"
            style={{ cursor: 'pointer' }}
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
              <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
