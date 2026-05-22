import { invoke } from './invoke'

// ─── Git commands ─────────────────────────────────────────────────────────

export async function createTaskBranch(
  repoPath: string,
  taskSlug: string,
  baseBranch?: string,
): Promise<string> {
  return invoke<string>('create_task_branch', { repoPath, taskSlug, baseBranch })
}

export async function switchBranch(repoPath: string, branch: string): Promise<void> {
  return invoke('switch_branch', { repoPath, branch })
}

export async function getCurrentBranch(repoPath: string): Promise<string> {
  return invoke<string>('get_current_branch', { repoPath })
}

export type BranchInfo = {
  name: string
  isHead: boolean
  upstream: string | null
}

export async function listTaskBranches(repoPath: string): Promise<BranchInfo[]> {
  return invoke<BranchInfo[]>('list_task_branches', { repoPath })
}

export async function deleteTaskBranch(repoPath: string, branch: string): Promise<boolean> {
  return invoke<boolean>('delete_task_branch', { repoPath, branch })
}

export type FileChange = {
  path: string
  status: string
  additions: number
  deletions: number
}

export type ChangeSummary = {
  files: FileChange[]
  totalAdditions: number
  totalDeletions: number
  totalFiles: number
}

export async function getChanges(repoPath: string, branch: string, baseBranch?: string): Promise<ChangeSummary> {
  return invoke<ChangeSummary>('get_changes', { repoPath, branch, baseBranch })
}

export async function getDiff(
  repoPath: string,
  branch: string,
  baseBranch?: string,
  filePath?: string,
): Promise<string> {
  return invoke<string>('get_diff', { repoPath, branch, baseBranch, filePath })
}

export async function getCommitChanges(repoPath: string, commitHash: string): Promise<ChangeSummary> {
  return invoke<ChangeSummary>('get_commit_changes', { repoPath, commitHash })
}

export async function getCommitDiff(
  repoPath: string,
  commitHash: string,
  filePath?: string,
): Promise<string> {
  return invoke<string>('get_commit_diff', { repoPath, commitHash, filePath })
}

export type CommitInfo = {
  hash: string
  shortHash: string
  message: string
  author: string
  timestamp: number
}

export async function getCommits(repoPath: string, branch: string, baseBranch?: string): Promise<CommitInfo[]> {
  return invoke<CommitInfo[]>('get_commits', { repoPath, branch, baseBranch })
}

export async function getCommitInfo(repoPath: string, commitHash: string): Promise<CommitInfo> {
  return invoke<CommitInfo>('get_commit_info', { repoPath, commitHash })
}

export type ConflictEntry = {
  file: string
  branches: string[]
}

export type ConflictMatrix = {
  conflicts: ConflictEntry[]
  hasConflicts: boolean
}

export async function getConflictMatrix(repoPath: string, baseBranch?: string): Promise<ConflictMatrix> {
  return invoke<ConflictMatrix>('get_conflict_matrix', { repoPath, baseBranch })
}
