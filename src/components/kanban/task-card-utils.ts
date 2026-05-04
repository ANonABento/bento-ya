import type { Task, PipelineState } from '@/types'

export const PIPELINE_LABELS: Record<PipelineState, string> = {
  idle: '',
  triggered: 'Trigger fired',
  running: 'Agent working',
  evaluating: 'Checking exit',
  advancing: 'Auto-advancing',
  setup_queued: 'Waiting for setup slot',
}

export const PIPELINE_COLORS: Record<PipelineState, string> = {
  idle: '',
  triggered: 'border-l-warning',
  running: 'border-l-running',
  evaluating: 'border-l-accent',
  advancing: 'border-l-success',
  setup_queued: 'border-l-warning',
}

// Helper to format relative time
export function formatRelativeTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)
  const diffHours = Math.floor(diffMins / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffMins < 1) return 'now'
  if (diffMins < 60) return `${String(diffMins)}m`
  if (diffHours < 24) return `${String(diffHours)}h`
  if (diffDays < 7) return `${String(diffDays)}d`
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// Get agent activity text based on status and pipeline state
export function getAgentActivity(task: Task): { text: string; type: 'active' | 'waiting' | 'idle' | 'error' | 'queued' } | null {
  // Don't show activity if no agent status or idle
  if (!task.agentStatus || task.agentStatus === 'idle') return null

  // Error state takes priority
  if (task.agentStatus === 'failed' || task.pipelineError) {
    return { text: task.pipelineError || 'Agent failed', type: 'error' }
  }

  // Queued state
  if (task.agentStatus === 'queued') {
    return { text: 'Queued...', type: 'queued' }
  }

  // Needs attention
  if (task.agentStatus === 'needs_attention') {
    return { text: 'Waiting for input...', type: 'waiting' }
  }

  // Running states
  if (task.agentStatus === 'running') {
    switch (task.pipelineState) {
      case 'triggered':
        return { text: 'Starting up...', type: 'active' }
      case 'running':
        return { text: 'Agent working...', type: 'active' }
      case 'evaluating':
        return { text: 'Checking results...', type: 'active' }
      case 'advancing':
        return { text: 'Moving to next step...', type: 'active' }
      default:
        return { text: 'Agent running', type: 'active' }
    }
  }

  // Completed
  if (task.agentStatus === 'completed') {
    return { text: 'Completed', type: 'idle' }
  }

  // Stopped - only show if recently updated (remaining case after all other checks)
  const updatedMs = new Date(task.updatedAt).getTime()
  const nowMs = Date.now()
  const hourAgo = 60 * 60 * 1000
  // Only show "idle" if updated within the last hour
  if (nowMs - updatedMs < hourAgo) {
    return { text: 'Agent idle', type: 'idle' }
  }

  return null
}
