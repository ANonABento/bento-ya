import type { Task } from '@/types'
import type { AgentStream } from '@/stores/agent-streaming-store'
import { getAgentActivity, formatRelativeTime } from './task-card-utils'

/** Live agent streaming preview or static activity status. */
export function AgentActivityPreview({
  task,
  agentStream,
}: {
  task: Task
  agentStream: AgentStream | undefined
}) {
  // Live streaming data takes priority
  if (agentStream) {
    const elapsed = Math.floor((Date.now() - agentStream.startTime) / 1000)
    const elapsedStr = elapsed < 60 ? `${String(elapsed)}s` : `${String(Math.floor(elapsed / 60))}m`

    // Show active tool or last content snippet
    const preview = agentStream.activeTool
      ? agentStream.activeTool.name
      : agentStream.lastContent.trim().split('\n').pop()?.slice(0, 80) || 'Working...'

    return (
      <div className="space-y-1">
        <div className="flex items-center gap-1.5 text-[11px] text-running">
          <span className="relative flex h-1.5 w-1.5 shrink-0">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-running opacity-75" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-running" />
          </span>
          {agentStream.activeTool ? (
            <span className="truncate font-mono">{preview}</span>
          ) : (
            <span className="truncate">{preview}</span>
          )}
          <span className="text-text-secondary/50 ml-auto shrink-0 tabular-nums">{elapsedStr}</span>
        </div>
        {agentStream.toolCount > 0 && (
          <div className="flex items-center gap-1 text-[10px] text-text-secondary/60 pl-3">
            <svg className="h-2.5 w-2.5" viewBox="0 0 16 16" fill="currentColor">
              <path d="M5.433 2.304A4.492 4.492 0 0 0 3.5 6c0 1.598.832 3.002 2.09 3.802.518.328.929.923.902 1.64v.008l-.164 3.337a.75.75 0 1 1-1.498-.073l.163-3.34c.007-.14-.1-.313-.37-.484A5.988 5.988 0 0 1 2 6a5.992 5.992 0 0 1 2.567-4.92 1.477 1.477 0 0 1 .433-.224ZM6.5 14h3a.75.75 0 0 1 0 1.5h-3a.75.75 0 0 1 0-1.5Zm4.157-11.696a.75.75 0 0 1 1.343.392 5.992 5.992 0 0 1-2.567 4.92 1.477 1.477 0 0 1-.433.224.75.75 0 0 1-.71-1.321A4.492 4.492 0 0 0 12.5 6c0-1.598-.832-3.002-2.09-3.802-.518-.328-.929-.923-.902-1.64V.55l.164-3.337a.75.75 0 0 1 1.498.073L11.006 .623c-.007.14.1.313.37.484Z" />
            </svg>
            <span>{agentStream.toolCount} tool{agentStream.toolCount !== 1 ? 's' : ''}</span>
          </div>
        )}
      </div>
    )
  }

  // Fallback: static activity from task state
  const activity = getAgentActivity(task)
  if (!activity) return null

  const colorClasses = {
    active: 'text-running',
    waiting: 'text-attention',
    idle: 'text-text-secondary/70',
    error: 'text-error',
    queued: 'text-warning',
  }

  return (
    <div className={`flex items-center gap-1.5 text-[11px] ${colorClasses[activity.type]}`}>
      {activity.type === 'active' && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-running opacity-75" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-running" />
        </span>
      )}
      <span className="truncate">{activity.text}</span>
      <span className="text-text-secondary/50 ml-auto">
        {formatRelativeTime(task.updatedAt)}
      </span>
    </div>
  )
}
