import { useState, useEffect, useRef } from 'react'
import type { AgentStatus } from '@/types'

type UsageSectionProps = {
  agentType: string | null
  agentStatus: AgentStatus | null
  startedAt: string | null
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${String(hours)}h ${String(minutes % 60)}m`
  }
  if (minutes > 0) {
    return `${String(minutes)}m ${String(seconds % 60)}s`
  }
  return `${String(seconds)}s`
}

export function UsageSection({ agentType, agentStatus, startedAt }: UsageSectionProps) {
  const [elapsed, setElapsed] = useState(0)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (agentStatus === 'running' && startedAt) {
      const start = new Date(startedAt).getTime()

      const tick = () => {
        setElapsed(Date.now() - start)
      }
      tick()
      intervalRef.current = setInterval(tick, 1000)

      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current)
      }
    }

    // For non-running statuses, keep the last elapsed value
    return undefined
  }, [agentStatus, startedAt])

  return (
    <div className="rounded-lg border border-border-default bg-surface p-3">
      <h4 className="mb-2 text-[11px] font-medium uppercase tracking-wider text-text-secondary">
        Usage
      </h4>
      <div className="space-y-1.5">
        <Row label="Agent" value={agentType ?? 'None'} />
        <Row label="Model" value="Claude" />
        <Row label="Tokens" value="— / —" muted />
        <Row
          label="Duration"
          value={startedAt ? formatDuration(elapsed) : '—'}
          muted={!startedAt}
        />
      </div>
    </div>
  )
}

function Row({
  label,
  value,
  muted = false,
}: {
  label: string
  value: string
  muted?: boolean
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-text-secondary">{label}</span>
      <span className={muted ? 'text-text-secondary' : 'text-text-primary'}>
        {value}
      </span>
    </div>
  )
}
