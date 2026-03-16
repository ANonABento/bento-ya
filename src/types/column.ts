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
}

// ─── Column Triggers ────────────────────────────────────────────────────────

export interface ColumnTriggers {
  on_entry?: TriggerAction
  on_exit?: TriggerAction
  exit_criteria?: ExitCriteria
}

// ─── Legacy Types (for migration) ───────────────────────────────────────────

/** @deprecated Use TriggerAction instead */
export type TriggerType = 'none' | 'agent' | 'skill' | 'script' | 'webhook'

/** @deprecated Use TriggerAction instead */
export type ExitType =
  | 'manual'
  | 'agent_complete'
  | 'script_success'
  | 'checklist_done'
  | 'pr_approved'
  | 'notification_sent'

/** @deprecated Use ColumnTriggers instead */
export type TriggerConfig = {
  type: string
  config: {
    agent?: string
    skill?: string
    script?: string
    webhook?: string
    flags?: string[]
  }
}

/** @deprecated Use ExitCriteria instead */
export type ExitConfig = {
  type: string
  config: {
    timeout?: number
    retry?: boolean
    maxRetry?: number
  }
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

  /** New unified triggers config */
  triggers?: ColumnTriggers

  /** @deprecated Use triggers.on_entry instead */
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  trigger: TriggerConfig
  /** @deprecated Use triggers.exit_criteria instead */
  // eslint-disable-next-line @typescript-eslint/no-deprecated
  exitCriteria: ExitConfig
  /** @deprecated Use triggers.exit_criteria.auto_advance instead */
  autoAdvance: boolean

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

/** Convert legacy trigger config to new format */
// eslint-disable-next-line @typescript-eslint/no-deprecated -- intentionally accepts legacy types
export function migrateTriggerConfig(trigger: TriggerConfig, exit: ExitConfig, autoAdvance: boolean): ColumnTriggers {
  let on_entry: TriggerAction = { type: 'none' }

  if (trigger.type === 'agent') {
    on_entry = {
      type: 'spawn_cli',
      cli: (trigger.config.agent ?? 'claude') as CliType,
      command: '/start-task',
      prompt_template: '{task.title}\n\n{task.description}\n\n{task.trigger_prompt}',
      flags: trigger.config.flags,
      use_queue: true,
    }
  } else if (trigger.type === 'skill') {
    on_entry = {
      type: 'spawn_cli',
      cli: 'claude',
      command: trigger.config.skill ? `/${trigger.config.skill}` : '/code-check',
      flags: trigger.config.flags,
      use_queue: true,
    }
  } else if (trigger.type === 'script') {
    on_entry = {
      type: 'spawn_cli',
      command: trigger.config.script,
      use_queue: false,
    }
  }
  // webhook not supported in V1 - maps to none

  const on_exit: TriggerAction = autoAdvance
    ? { type: 'move_column', target: 'next' }
    : { type: 'none' }

  return {
    on_entry,
    on_exit,
    exit_criteria: {
      type: exit.type as ExitCriteriaType,
      timeout: exit.config.timeout,
      auto_advance: autoAdvance,
    },
  }
}
