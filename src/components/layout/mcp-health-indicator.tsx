import { motion } from 'motion/react'
import { Tooltip } from '@/components/shared/tooltip'
import { useMcpHealth } from '@/hooks/use-mcp-health'
import type { McpHealthStatus } from '@/lib/ipc/mcp'

const STATUS_LABEL: Record<McpHealthStatus, string> = {
  healthy: 'MCP healthy',
  restarting: 'MCP restarting',
  failed: 'MCP failed',
  not_installed: 'MCP not installed',
}

const STATUS_DOT: Record<McpHealthStatus, string> = {
  healthy: 'bg-emerald-500',
  restarting: 'bg-amber-400 animate-pulse',
  failed: 'bg-rose-500',
  not_installed: 'bg-zinc-400',
}

export function McpHealthIndicator() {
  const health = useMcpHealth()
  if (!health) return null

  const dotClass = STATUS_DOT[health.status]
  const label = STATUS_LABEL[health.status]
  const detail = health.message ?? health.lastError ?? ''
  const tooltip = detail ? `${label} — ${detail}` : label

  return (
    <Tooltip content={tooltip} side="bottom">
      <motion.div
        whileHover={{ scale: 1.05 }}
        className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs text-text-secondary"
        aria-label={tooltip}
        data-testid="mcp-health-indicator"
        data-status={health.status}
      >
        <span className={`inline-block h-2 w-2 rounded-full ${dotClass}`} />
        <span className="font-mono">MCP</span>
      </motion.div>
    </Tooltip>
  )
}
