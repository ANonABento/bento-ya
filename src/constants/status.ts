/**
 * Centralized status constants with labels and colors.
 * Single source of truth for agent, pipeline, and review status UI.
 */

import type { AgentStatus, PipelineState, ReviewStatus, PrCiStatus, PrReviewDecision } from '@/types'

// ─── Agent Status ───────────────────────────────────────────────────────────

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
  queued: 'text-warning',
  running: 'text-running',
  completed: 'text-success',
  failed: 'text-error',
  stopped: 'text-text-secondary',
  needs_attention: 'text-attention',
}

export const AGENT_STATUS_BG_COLORS: Record<AgentStatus, string> = {
  idle: 'bg-surface-hover',
  queued: 'bg-warning',
  running: 'bg-running',
  completed: 'bg-success',
  failed: 'bg-error',
  stopped: 'bg-text-secondary',
  needs_attention: 'bg-attention',
}

// ─── Pipeline State ─────────────────────────────────────────────────────────

export const PIPELINE_STATE_LABELS: Record<PipelineState, string> = {
  idle: 'Idle',
  triggered: 'Starting',
  running: 'Running',
  evaluating: 'Checking',
  advancing: 'Moving',
}

export const PIPELINE_STATE_COLORS: Record<PipelineState, string> = {
  idle: 'text-text-secondary',
  triggered: 'text-warning',
  running: 'text-running',
  evaluating: 'text-accent',
  advancing: 'text-success',
}

// ─── Review Status ──────────────────────────────────────────────────────────

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  pending: 'Pending Review',
  approved: 'Approved',
  rejected: 'Rejected',
  'needs-manual-review': 'Needs Manual Review',
}

export const REVIEW_STATUS_COLORS: Record<ReviewStatus, string> = {
  pending: 'text-warning',
  approved: 'text-success',
  rejected: 'text-error',
  'needs-manual-review': 'text-attention',
}

// ─── PR/CI Status ───────────────────────────────────────────────────────────

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

// ─── Generic Badge Variants ─────────────────────────────────────────────────

export type BadgeVariant = 'default' | 'success' | 'warning' | 'error' | 'info' | 'running' | 'attention'

export const BADGE_COLORS: Record<BadgeVariant, { bg: string; text: string; dot: string }> = {
  default: { bg: 'bg-surface-hover', text: 'text-text-secondary', dot: 'bg-text-secondary' },
  success: { bg: 'bg-success/10', text: 'text-success', dot: 'bg-success' },
  warning: { bg: 'bg-warning/10', text: 'text-warning', dot: 'bg-warning' },
  error: { bg: 'bg-error/10', text: 'text-error', dot: 'bg-error' },
  info: { bg: 'bg-accent/10', text: 'text-accent', dot: 'bg-accent' },
  running: { bg: 'bg-running/10', text: 'text-running', dot: 'bg-running' },
  attention: { bg: 'bg-attention/10', text: 'text-attention', dot: 'bg-attention' },
}
