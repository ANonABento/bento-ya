import type { AgentMode, AgentStatus } from './agent'

export type PipelineState = 'idle' | 'triggered' | 'running' | 'evaluating' | 'advancing'

export type ReviewStatus = 'pending' | 'approved' | 'rejected'

export type Task = {
  id: string
  workspaceId: string
  columnId: string
  title: string
  description: string
  branch: string | null
  agentType: string | null
  agentMode: AgentMode | null
  agentStatus: AgentStatus | null
  pipelineState: PipelineState
  pipelineTriggeredAt: string | null
  pipelineError: string | null
  lastScriptExitCode: number | null
  reviewStatus: ReviewStatus | null
  prNumber: number | null
  prUrl: string | null
  position: number
  createdAt: string
  updatedAt: string
}

export type CreatePrResult = {
  prNumber: number
  prUrl: string
  task: Task
}
