import type { AgentMode, AgentStatus } from './agent'

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
  position: number
  createdAt: string
  updatedAt: string
}
