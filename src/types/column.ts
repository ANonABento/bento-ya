export type TriggerType = 'none' | 'agent' | 'skill' | 'script' | 'webhook'

export type ExitType =
  | 'manual'
  | 'agent_complete'
  | 'script_success'
  | 'checklist_done'
  | 'pr_approved'
  | 'notification_sent'

export type TriggerConfig = {
  type: TriggerType
  config: {
    agent?: string
    skill?: string
    script?: string
    webhook?: string
    flags?: string[]
  }
}

export type ExitConfig = {
  type: ExitType
  config: {
    timeout?: number
    retry?: boolean
    maxRetry?: number
  }
}

export type Column = {
  id: string
  workspaceId: string
  name: string
  icon: string
  position: number
  color: string
  visible: boolean
  trigger: TriggerConfig
  exitCriteria: ExitConfig
  autoAdvance: boolean
  createdAt: string
  updatedAt: string
}
