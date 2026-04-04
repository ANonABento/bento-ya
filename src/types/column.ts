// ─── Action Types ───────────────────────────────────────────────────────────

export type ActionType = 'spawn_cli' | 'move_column' | 'trigger_task' | 'none'

export type CliType = 'claude' | 'codex' | 'aider'

export interface SpawnCliAction {
  type: 'spawn_cli'
  /** CLI to spawn */
  cli?: CliType
  /** Slash command to run: /start-task, /loop-review, /code-check */
  command?: string
  /**
   * Prompt template with variable interpolation.
   * Variables: {task.id}, {task.title}, {task.description}, {task.trigger_prompt},
   *            {column.name}, {workspace.path}, {prev_column.name}, {dep.<id>.last_output}
   */
  prompt_template?: string
  /** Raw prompt (overrides template) */
  prompt?: string
  /** Additional CLI flags */
  flags?: string[]
  /** Use existing agent queue (default: true) */
  use_queue?: boolean
}

export interface MoveColumnAction {
  type: 'move_column'
  /** Target column: "next", "previous", or column_id */
  target: string
}

export interface TriggerTaskAction {
  type: 'trigger_task'
  /** Task ID or template like {dependency.task_id} */
  target_task: string
  /** What to do to the target task */
  action: 'move_column' | 'start' | 'unblock'
  /** Target column for move_column action */
  target_column?: string
  /** Prompt to inject into target task */
  inject_prompt?: string
}

export interface NoneAction {
  type: 'none'
}

export type TriggerAction = SpawnCliAction | MoveColumnAction | TriggerTaskAction | NoneAction

// ─── Exit Criteria ──────────────────────────────────────────────────────────

export type ExitCriteriaType =
  | 'manual'
  | 'agent_complete'
  | 'script_success'
  | 'checklist_done'
  | 'time_elapsed'
  | 'pr_approved'
  | 'manual_approval'
  | 'notification_sent'

export interface ExitCriteria {
  type: ExitCriteriaType
  /** Timeout in seconds (for time_elapsed) */
  timeout?: number
  /** Auto-advance when criteria met */
  auto_advance?: boolean
  /** Max retries on failure before giving up */
  max_retries?: number
}

// ─── Column Triggers ────────────────────────────────────────────────────────

export interface ColumnTriggers {
  on_entry?: TriggerAction
  on_exit?: TriggerAction
  exit_criteria?: ExitCriteria
}

// ─── Column ─────────────────────────────────────────────────────────────────

export type Column = {
  id: string
  workspaceId: string
  name: string
  icon: string
  position: number
  color: string
  visible: boolean

  /** Unified triggers config (V2) */
  triggers?: ColumnTriggers

  /** @deprecated Legacy fields — still sent by backend, use getColumnTriggers() instead */
  triggerConfig?: string
  exitConfig?: string
  autoAdvance?: boolean

  createdAt: string
  updatedAt: string
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Default triggers config */
export const DEFAULT_TRIGGERS: ColumnTriggers = {
  on_entry: { type: 'none' },
  on_exit: { type: 'none' },
  exit_criteria: { type: 'manual', auto_advance: false },
}

/** Default spawn_cli action */
export const DEFAULT_SPAWN_CLI: SpawnCliAction = {
  type: 'spawn_cli',
  cli: 'claude',
  command: '/start-task',
  prompt_template: '{task.title}\n\n{task.description}\n\n{task.trigger_prompt}',
  use_queue: true,
}

/** Resolve V2 triggers from a column, with safe fallback */
export function getColumnTriggers(column: Column): ColumnTriggers {
  if (column.triggers && Object.keys(column.triggers).length > 0) {
    return column.triggers
  }
  return DEFAULT_TRIGGERS
}
