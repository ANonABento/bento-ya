// Session history IPC commands

import { invoke } from './core'

// ─── Types ─────────────────────────────────────────────────────────────────

export type SessionSnapshot = {
  id: string
  sessionId: string
  workspaceId: string
  taskId: string | null
  snapshotType: 'checkpoint' | 'complete' | 'error'
  scrollbackSnapshot: string | null
  commandHistory: string
  filesModified: string
  durationMs: number
  createdAt: string
}

export type RestoreSnapshotParams = {
  snapshotId: string
  currentSessionId: string
  currentWorkspaceId: string
  currentTaskId?: string
  currentScrollback?: string
  currentCommandHistory: string
  currentFilesModified: string
  currentDurationMs: number
}

// ─── Session history commands ────────────────────────────────────────────────

export async function createSnapshot(
  sessionId: string,
  workspaceId: string,
  snapshotType: string,
  commandHistory: string,
  filesModified: string,
  durationMs: number,
  taskId?: string,
  scrollbackSnapshot?: string,
): Promise<SessionSnapshot> {
  return invoke<SessionSnapshot>('create_snapshot', {
    sessionId,
    workspaceId,
    taskId,
    snapshotType,
    scrollbackSnapshot,
    commandHistory,
    filesModified,
    durationMs,
  })
}

export async function getSnapshot(id: string): Promise<SessionSnapshot> {
  return invoke<SessionSnapshot>('get_snapshot', { id })
}

export async function getSessionHistory(sessionId: string): Promise<SessionSnapshot[]> {
  return invoke<SessionSnapshot[]>('get_session_history', { sessionId })
}

export async function getWorkspaceHistory(
  workspaceId: string,
  limit?: number,
): Promise<SessionSnapshot[]> {
  return invoke<SessionSnapshot[]>('get_workspace_history', { workspaceId, limit })
}

export async function getTaskHistory(taskId: string): Promise<SessionSnapshot[]> {
  return invoke<SessionSnapshot[]>('get_task_history', { taskId })
}

export async function clearSessionHistory(sessionId: string): Promise<void> {
  return invoke<void>('clear_session_history', { sessionId })
}

export async function restoreSnapshot(params: RestoreSnapshotParams): Promise<SessionSnapshot> {
  return invoke<SessionSnapshot>('restore_snapshot', params)
}
