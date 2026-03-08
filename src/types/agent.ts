export type AgentStatus =
  | 'idle'
  | 'queued'
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

export type AgentMessage = {
  id: string
  taskId: string
  role: string
  content: string
  model: string | null
  effortLevel: string | null
  toolCalls: string | null // JSON string
  thinkingContent: string | null
  createdAt: string
}
