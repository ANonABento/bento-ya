// GitHub PR status IPC commands

import { invoke } from './core'

// ─── Types ─────────────────────────────────────────────────────────────────

export type PrStatusResponse = {
  taskId: string
  prNumber: number
  mergeable: 'mergeable' | 'conflicted' | 'unknown'
  ciStatus: 'pending' | 'success' | 'failure' | 'error'
  reviewDecision: string | null
  commentCount: number
  isDraft: boolean
  labels: string[]
  headSha: string
  state: string
}

// ─── GitHub PR status commands ────────────────────────────────────────────────

export async function fetchPrStatus(
  taskId: string,
  repoPath: string,
): Promise<PrStatusResponse> {
  return invoke<PrStatusResponse>('fetch_pr_status', { taskId, repoPath })
}

export async function fetchPrStatusBatch(
  taskIds: string[],
  repoPath: string,
): Promise<PrStatusResponse[]> {
  return invoke<PrStatusResponse[]>('fetch_pr_status_batch', { taskIds, repoPath })
}

export async function shouldRefreshPrStatus(
  taskId: string,
  maxAgeSeconds: number,
): Promise<boolean> {
  return invoke<boolean>('should_refresh_pr_status', { taskId, maxAgeSeconds })
}
