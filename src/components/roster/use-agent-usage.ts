import { useEffect, useState } from 'react'
import type { AgentUsage } from '@/types'
import * as ipc from '@/lib/ipc'

/**
 * Which columns currently run this agent.
 *
 * Fetched rather than derived from a store because columns are per-workspace
 * and only the open workspace's are loaded, while agents are global — an agent
 * is very often attached to a board that isn't on screen.
 */
export function useAgentUsage(agentId: string | undefined): AgentUsage[] {
  const [usage, setUsage] = useState<AgentUsage[]>([])

  useEffect(() => {
    if (!agentId) {
      setUsage([])
      return
    }
    let live = true
    ipc
      .getAgentUsage(agentId)
      .then((rows) => {
        if (live) setUsage(rows)
      })
      .catch(() => {
        // Usage is advisory — a failed lookup shouldn't blank the dossier.
        if (live) setUsage([])
      })
    return () => {
      live = false
    }
  }, [agentId])

  return usage
}

/** "Review in Alpha" / "2 columns" — the phrasing both the dossier and the
 *  delete confirmation use, so they can't describe the same thing differently. */
export function describeUsage(usage: AgentUsage[]): string {
  if (usage.length === 0) return 'Not used by any column'
  const only = usage.length === 1 ? usage[0] : undefined
  if (only) {
    return `Used by ${only.columnName} in ${only.workspaceName}`
  }
  return `Used by ${String(usage.length)} columns`
}
