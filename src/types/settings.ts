// Settings types for global and per-workspace configuration

export type ProviderConfig = {
  id: string
  name: string
  apiKeyEnvVar: string
  enabled: boolean
  connectionMode: 'api' | 'cli'
  cliPath?: string
  defaultModel: string
}

export type AgentConfig = {
  maxConcurrentAgents: number
  envVars: Record<string, string>
  instructionsFile: string
  modelSelection: 'auto' | string // 'auto' = orchestrator decides, or specific model ID
}

export type AgentMode = {
  id: string
  name: string
  icon: string
  prompt: string
  tools: string[]
  isBuiltIn: boolean
}

export type ModelConfig = {
  showCostEstimates: boolean
  providers: ProviderConfig[]
}

export type McpServer = {
  id: string
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  autoStart: boolean
  status: 'connected' | 'disconnected' | 'error'
}

export type Skill = {
  id: string
  name: string
  description: string
  trigger: string
  script: string
}

export type WhisperModelId = 'tiny' | 'base' | 'small' | 'medium' | 'large'

export type VoiceConfig = {
  enabled: boolean
  model: WhisperModelId
  language: string
  hotkey: string
  sensitivity: number
  pushToTalk: boolean
}

export type GitConfig = {
  branchPrefix: string
  autoPr: boolean
  prTemplate: string
  mergeStrategy: 'merge' | 'squash' | 'rebase'
  baseBranch: string
}

export type AppearanceConfig = {
  theme: 'dark' | 'light' | 'system'
  accentColor: string
  fontSize: 'small' | 'medium' | 'large'
  cardDensity: 'compact' | 'comfortable' | 'spacious'
  animationSpeed: 'none' | 'reduced' | 'normal'
}

export type ShortcutConfig = {
  id: string
  action: string
  keys: string
  enabled: boolean
}

export type Settings = {
  agent: AgentConfig
  modes: AgentMode[]
  model: ModelConfig
  mcpServers: McpServer[]
  skills: Skill[]
  voice: VoiceConfig
  git: GitConfig
  appearance: AppearanceConfig
  shortcuts: ShortcutConfig[]
}

export type WorkspaceSettings = Partial<Settings>

export const DEFAULT_SETTINGS: Settings = {
  agent: {
    maxConcurrentAgents: 10,
    envVars: {},
    instructionsFile: '',
    modelSelection: 'auto',
  },
  modes: [
    { id: 'code', name: 'Code', icon: 'code', prompt: 'Write clean, maintainable code', tools: ['read', 'write', 'bash'], isBuiltIn: true },
    { id: 'plan', name: 'Plan', icon: 'plan', prompt: 'Create detailed implementation plans', tools: ['read', 'search'], isBuiltIn: true },
    { id: 'review', name: 'Review', icon: 'review', prompt: 'Review code for issues and improvements', tools: ['read', 'search'], isBuiltIn: true },
  ],
  model: {
    showCostEstimates: true,
    providers: [
      {
        id: 'anthropic',
        name: 'Anthropic',
        apiKeyEnvVar: 'ANTHROPIC_API_KEY',
        enabled: true,
        connectionMode: 'cli',
        cliPath: 'claude',
        defaultModel: 'claude-sonnet-4-6-20260217',
      },
      {
        id: 'openai',
        name: 'OpenAI',
        apiKeyEnvVar: 'OPENAI_API_KEY',
        enabled: false,
        connectionMode: 'cli',
        cliPath: 'codex',
        defaultModel: 'codex-5.3',
      },
    ],
  },
  mcpServers: [],
  skills: [],
  voice: {
    enabled: false,
    model: 'tiny',
    language: 'en',
    hotkey: 'Cmd+Shift+V',
    sensitivity: 0.5,
    pushToTalk: true,
  },
  git: {
    branchPrefix: 'feat/',
    autoPr: false,
    prTemplate: '',
    mergeStrategy: 'squash',
    baseBranch: 'main',
  },
  appearance: {
    theme: 'system',
    accentColor: '#E8A87C',
    fontSize: 'medium',
    cardDensity: 'comfortable',
    animationSpeed: 'normal',
  },
  shortcuts: [
    { id: 'new-task', action: 'Create New Task', keys: 'Cmd+N', enabled: true },
    { id: 'search', action: 'Search', keys: 'Cmd+K', enabled: true },
    { id: 'toggle-theme', action: 'Toggle Theme', keys: 'Cmd+Shift+T', enabled: true },
    { id: 'settings', action: 'Open Settings', keys: 'Cmd+,', enabled: true },
  ],
}
