export type AgentStatus =
  | 'running'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'needs_attention'

export type AgentMode =
  | 'code'
  | 'architect'
  | 'debug'
  | 'ask'
  | 'plan'
  | 'review'

export type AgentSession = {
  id: string
  taskId: string
  agentType: string
  pid: number | null
  status: AgentStatus
  startedAt: string
  endedAt: string | null
  tokenUsage: number
}
