import type { AgentMode, AgentStatus } from './agent'

export type PipelineState = 'idle' | 'triggered' | 'running' | 'evaluating' | 'advancing'

export type ReviewStatus = 'pending' | 'approved' | 'rejected'

export type PrMergeable = 'mergeable' | 'conflicted' | 'unknown'
export type PrCiStatus = 'pending' | 'success' | 'failure' | 'error'
export type PrReviewDecision = 'approved' | 'changes_requested' | 'review_required'

// Task checklist item (stored as JSON array in task.checklist)
export type TaskChecklistItem = {
  id: string
  text: string
  checked: boolean
}

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
  queuedAt: string | null
  pipelineState: PipelineState
  pipelineTriggeredAt: string | null
  pipelineError: string | null
  retryCount: number
  lastScriptExitCode: number | null
  reviewStatus: ReviewStatus | null
  prNumber: number | null
  prUrl: string | null
  // Siege loop fields
  siegeIteration: number
  siegeActive: boolean
  siegeMaxIterations: number
  siegeLastChecked: string | null
  // PR/CI status fields (from GitHub API)
  prMergeable: PrMergeable | null
  prCiStatus: PrCiStatus | null
  prReviewDecision: PrReviewDecision | null
  prCommentCount: number
  prIsDraft: boolean
  prLabels: string  // JSON array
  prLastFetched: string | null
  prHeadSha: string | null
  // Task checklist (JSON array of TaskChecklistItem)
  checklist: string | null
  // Notification fields
  notifyStakeholders: string | null  // JSON array of stakeholder names/emails
  notificationSentAt: string | null
  // Trigger override fields (V1 column triggers)
  triggerOverrides: string | null  // JSON - task-level trigger overrides
  triggerPrompt: string | null     // Custom prompt fed to agent
  lastOutput: string | null        // Last output from trigger execution
  dependencies: string | null      // JSON array of dependency specs
  blocked: boolean                 // Whether task is blocked by dependencies
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
