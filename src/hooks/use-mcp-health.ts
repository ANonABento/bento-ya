import { useEffect, useState } from 'react'
import { getMcpHealth, MCP_HEALTH_EVENT, type McpHealth } from '@/lib/ipc/mcp'
import { listen } from '@/lib/ipc'

export function useMcpHealth(): McpHealth | null {
  const [health, setHealth] = useState<McpHealth | null>(null)

  useEffect(() => {
    let unlisten: (() => void) | undefined
    let cancelled = false

    getMcpHealth()
      .then((h) => { if (!cancelled) setHealth(h) })
      .catch(() => { /* supervisor not registered yet — wait for events */ })

    listen<McpHealth>(MCP_HEALTH_EVENT, (payload) => {
      if (!cancelled) setHealth(payload)
    })
      .then((fn) => {
        // If unmount raced ahead of listen() resolving, drop the subscription
        // immediately instead of leaking it.
        if (cancelled) fn()
        else unlisten = fn
      })
      .catch(() => { /* event subsystem unavailable */ })

    return () => {
      cancelled = true
      if (unlisten) unlisten()
    }
  }, [])

  return health
}
