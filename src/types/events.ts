// Event payload TypeScript interfaces — source of truth for all event channel names.
// Keep in sync with src-tauri/src/events.rs.

// ─── Event channel name helpers ────────────────────────────────────────────

export const EventChannels = {
  ptyOutput: (taskId: string) => `pty:${taskId}:output` as const,
  ptyExit: (taskId: string) => `pty:${taskId}:exit` as const,
  agentStatus: (taskId: string) => `agent:${taskId}:status` as const,
  taskUpdated: (taskId: string) => `task:${taskId}:updated` as const,
  gitChanges: (taskId: string) => `git:${taskId}:changes` as const,
  workspaceUpdated: (id: string) => `workspace:${id}:updated` as const,
} as const

// ─── Event payloads ────────────────────────────────────────────────────────

export interface PtyOutputPayload {
  task_id: string
  data: number[]
}

export interface PtyExitPayload {
  task_id: string
  exit_code: number | null
}

export type AgentStatus = 'running' | 'completed' | 'failed' | 'needs_attention'

export interface AgentStatusPayload {
  task_id: string
  status: AgentStatus
}

export interface TaskUpdatedPayload {
  task_id: string
  column_id?: string | null
  title?: string | null
  position?: number | null
}

export type FileChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed'

export interface FileChange {
  path: string
  status: FileChangeStatus
}

export interface GitChangesPayload {
  task_id: string
  files: FileChange[]
}

export interface WorkspaceUpdatedPayload {
  workspace_id: string
  name?: string | null
}

// ─── Discriminated union for all events ────────────────────────────────────

export type AppEvent =
  | { type: 'pty_output'; payload: PtyOutputPayload }
  | { type: 'pty_exit'; payload: PtyExitPayload }
  | { type: 'agent_status'; payload: AgentStatusPayload }
  | { type: 'task_updated'; payload: TaskUpdatedPayload }
  | { type: 'git_changes'; payload: GitChangesPayload }
  | { type: 'workspace_updated'; payload: WorkspaceUpdatedPayload }

// ─── Backend data models (matching Rust structs) ───────────────────────────

export interface Workspace {
  id: string
  name: string
  repo_path: string
  tab_order: number
  is_active: boolean
  created_at: string
  updated_at: string
}

export interface Column {
  id: string
  workspace_id: string
  name: string
  position: number
  color: string | null
  visible: boolean
  created_at: string
  updated_at: string
}

export interface Task {
  id: string
  workspace_id: string
  column_id: string
  title: string
  description: string | null
  position: number
  priority: string
  agent_mode: string | null
  branch_name: string | null
  files_touched: string
  checklist: string | null
  pipeline_state: string
  pipeline_triggered_at: string | null
  pipeline_error: string | null
  agent_session_id: string | null
  last_script_exit_code: number | null
  created_at: string
  updated_at: string
}

export interface AgentSession {
  id: string
  task_id: string
  pid: number | null
  status: string
  pty_cols: number
  pty_rows: number
  last_output: string | null
  exit_code: number | null
  created_at: string
  updated_at: string
}

// ─── Error response type ───────────────────────────────────────────────────

export interface AppError {
  kind: 'NotFound' | 'InvalidInput' | 'DatabaseError'
  message: string
}
