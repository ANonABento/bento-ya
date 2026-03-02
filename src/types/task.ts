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
  // Siege loop fields
  siegeIteration: number
  siegeActive: boolean
  siegeMaxIterations: number
  siegeLastChecked: string | null
  position: number
  createdAt: string
  updatedAt: string
}

export type CreatePrResult = {
  prNumber: number
  prUrl: string
  task: Task
}

// ─── Siege Loop Types ───────────────────────────────────────────────────────

export type PrComment = {
  id: number
  body: string
  author: string
  path: string | null
  line: number | null
  createdAt: string
  state: string | null
}

export type PrStatus = {
  number: number
  state: string         // OPEN, CLOSED, MERGED
  reviewDecision: string | null // APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED
  comments: PrComment[]
  unresolvedCount: number
}

export type StartSiegeResult = {
  task: Task
  prStatus: PrStatus
  agentSpawned: boolean
  message: string
}

export type CheckSiegeResult = {
  task: Task
  prStatus: PrStatus
  shouldContinue: boolean
  reason: string
}

export type SiegeEvent = {
  taskId: string
  eventType: string
  iteration: number
  maxIterations: number
  message: string
}
