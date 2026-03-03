import type { AgentMode, AgentStatus } from './agent'

export type PipelineState = 'idle' | 'triggered' | 'running' | 'evaluating' | 'advancing'

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
  position: number
  createdAt: string
  updatedAt: string
}
