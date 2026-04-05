// ─── Script Types ──────────────────────────────────────────────────────────

export type StepType = 'bash' | 'agent' | 'check'

export interface BashStep {
  type: 'bash'
  name?: string
  command: string
  workDir?: string
  continueOnError?: boolean
}

export interface AgentStep {
  type: 'agent'
  name?: string
  prompt: string
  model?: string
  command?: string
}

export interface CheckStep {
  type: 'check'
  name?: string
  command: string
  failMessage?: string
}

export type ScriptStep = BashStep | AgentStep | CheckStep

export interface Script {
  id: string
  name: string
  description: string
  steps: string // JSON array of ScriptStep
  isBuiltIn: boolean
  createdAt: string
  updatedAt: string
}

/** Parse the steps JSON string into typed steps */
export function parseSteps(stepsJson: string): ScriptStep[] {
  try {
    return JSON.parse(stepsJson) as ScriptStep[]
  } catch {
    return []
  }
}
