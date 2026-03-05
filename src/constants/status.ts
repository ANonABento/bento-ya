import type { AgentStatus, PipelineState, ReviewStatus, PrCiStatus, PrReviewDecision } from '@/types'

// ─── Agent Status ───────────────────────────────────────────────────────────

export const AGENT_STATUS = {
  IDLE: 'idle',
  QUEUED: 'queued',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
  STOPPED: 'stopped',
  NEEDS_ATTENTION: 'needs_attention',
} as const

export const AGENT_STATUS_LABELS: Record<AgentStatus, string> = {
  idle: 'Idle',
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  stopped: 'Stopped',
  needs_attention: 'Needs Attention',
}

export const AGENT_STATUS_COLORS: Record<AgentStatus, string> = {
  idle: 'text-text-secondary',
  queued: 'text-accent',
  running: 'text-accent',
  completed: 'text-success',
  failed: 'text-error',
  stopped: 'text-warning',
  needs_attention: 'text-attention',
}

// ─── Pipeline State ─────────────────────────────────────────────────────────

export const PIPELINE_STATE = {
  IDLE: 'idle',
  TRIGGERED: 'triggered',
  RUNNING: 'running',
  EVALUATING: 'evaluating',
  ADVANCING: 'advancing',
} as const

export const PIPELINE_STATE_LABELS: Record<PipelineState, string> = {
  idle: '',
  triggered: 'Starting',
  running: 'Running',
  evaluating: 'Checking',
  advancing: 'Moving',
}

export const PIPELINE_STATE_COLORS: Record<PipelineState, string> = {
  idle: 'text-text-secondary',
  triggered: 'text-accent',
  running: 'text-accent',
  evaluating: 'text-warning',
  advancing: 'text-success',
}

// ─── Review Status ──────────────────────────────────────────────────────────

export const REVIEW_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
} as const

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  pending: 'Pending Review',
  approved: 'Approved',
  rejected: 'Changes Requested',
}

export const REVIEW_STATUS_COLORS: Record<ReviewStatus, string> = {
  pending: 'text-warning',
  approved: 'text-success',
  rejected: 'text-error',
}

// ─── PR CI Status ───────────────────────────────────────────────────────────

export const PR_CI_STATUS = {
  PENDING: 'pending',
  SUCCESS: 'success',
  FAILURE: 'failure',
  ERROR: 'error',
} as const

export const PR_CI_STATUS_LABELS: Record<PrCiStatus, string> = {
  pending: 'CI Pending',
  success: 'CI Passed',
  failure: 'CI Failed',
  error: 'CI Error',
}

export const PR_CI_STATUS_COLORS: Record<PrCiStatus, string> = {
  pending: 'text-warning',
  success: 'text-success',
  failure: 'text-error',
  error: 'text-error',
}

// ─── PR Review Decision ─────────────────────────────────────────────────────

export const PR_REVIEW_DECISION = {
  APPROVED: 'approved',
  CHANGES_REQUESTED: 'changes_requested',
  REVIEW_REQUIRED: 'review_required',
} as const

export const PR_REVIEW_DECISION_LABELS: Record<PrReviewDecision, string> = {
  approved: 'Approved',
  changes_requested: 'Changes Requested',
  review_required: 'Review Required',
}

export const PR_REVIEW_DECISION_COLORS: Record<PrReviewDecision, string> = {
  approved: 'text-success',
  changes_requested: 'text-error',
  review_required: 'text-warning',
}

// ─── Helper to get status color as variant ──────────────────────────────────

export type StatusVariant = 'success' | 'error' | 'warning' | 'info' | 'neutral'

export function getAgentStatusVariant(status: AgentStatus): StatusVariant {
  switch (status) {
    case 'completed':
      return 'success'
    case 'failed':
      return 'error'
    case 'stopped':
    case 'needs_attention':
      return 'warning'
    case 'running':
    case 'queued':
      return 'info'
    default:
      return 'neutral'
  }
}

export function getPipelineStateVariant(state: PipelineState): StatusVariant {
  switch (state) {
    case 'advancing':
      return 'success'
    case 'evaluating':
      return 'warning'
    case 'running':
    case 'triggered':
      return 'info'
    default:
      return 'neutral'
  }
}
