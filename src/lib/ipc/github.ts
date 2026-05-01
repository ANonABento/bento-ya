import { invoke } from './invoke'

// ─── GitHub Issues Sync commands ──────────────────────────────────────────────

export type GithubSyncResult = {
  issuesFetched: number
  tasksCreated: number
  issuesCommented: number
  prsLinked: number
}

export type GithubSyncState = {
  workspaceId: string
  lastSyncedAt: string | null
}

export async function syncGithubIssuesNow(workspaceId: string): Promise<GithubSyncResult> {
  return invoke<GithubSyncResult>('sync_github_issues_now', { workspaceId })
}

export async function getGithubSyncState(workspaceId: string): Promise<GithubSyncState | null> {
  return invoke<GithubSyncState | null>('get_github_sync_state', { workspaceId })
}

// ─── GitHub PR status commands ────────────────────────────────────────────────

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
