export type WorkspaceConfig = {
  defaultModel?: string
  defaultAgentCli?: string
  maxConcurrentAgents?: number
  autoAdvance?: boolean
  /** Auto-archive tasks that have sat in Done past the grace period. Default: true. */
  autoArchiveDone?: boolean
  /** How long a task must sit in Done before auto-archive (minutes). Default: 5. */
  autoArchiveGraceMinutes?: number
  githubRepo?: string
  githubLabelFilter?: string
  githubSyncEnabled?: boolean
  githubInboxColumnId?: string
  githubDoneColumnId?: string
  githubPrColumnId?: string
}

export type Workspace = {
  id: string
  name: string
  repoPath: string
  tabOrder: number
  isActive: boolean
  activeTaskCount: number
  config: string
  createdAt: string
  updatedAt: string
}

/** Parse the workspace config JSON string into a typed object. */
export function parseWorkspaceConfig(config: string): WorkspaceConfig {
  try {
    return JSON.parse(config) as WorkspaceConfig
  } catch {
    return {}
  }
}
