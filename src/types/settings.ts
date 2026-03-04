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

export type CardDisplayConfig = {
  showDescription: boolean
  showBranch: boolean
  showAgentType: boolean
  showTimestamp: boolean
  showPrBadge: boolean
  showCiStatus: boolean
  showReviewStatus: boolean
  showMergeStatus: boolean
  showCommentCount: boolean
  showLabels: boolean
  // PR polling settings
  prPollingEnabled: boolean
  prPollingIntervalSeconds: number
  prCacheMaxAgeSeconds: number
}

export type TerminalConfig = {
  maxInputRows: number
  lineHeight: number
  scrollbackLines: number
}

export type PanelConfig = {
  defaultHeight: number
  minHeight: number
  maxHeight: number
  collapsedHeight: number
}

export type GestureConfig = {
  swipeEnabled: boolean
  swipeThreshold: number
  swipeVelocityThreshold: number
}

export type AdvancedConfig = {
  settingsSyncDebounceMs: number
  notesDebounceMs: number
  messageTimeoutSeconds: number
  maxConcurrentTerminals: number
  outputBufferIntervalMs: number
}

export type WorkspaceDefaults = {
  defaultColumns: string[]
  branchPrefix: string
  autoStashPrefix: string
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
  cards: CardDisplayConfig
  shortcuts: ShortcutConfig[]
  terminal: TerminalConfig
  panel: PanelConfig
  gestures: GestureConfig
  advanced: AdvancedConfig
  workspaceDefaults: WorkspaceDefaults
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
  cards: {
    showDescription: true,
    showBranch: true,
    showAgentType: true,
    showTimestamp: true,
    showPrBadge: true,
    showCiStatus: true,
    showReviewStatus: true,
    showMergeStatus: true,
    showCommentCount: true,
    showLabels: true,
    prPollingEnabled: true,
    prPollingIntervalSeconds: 60,
    prCacheMaxAgeSeconds: 300,
  },
  shortcuts: [
    { id: 'new-task', action: 'Create New Task', keys: 'Cmd+N', enabled: true },
    { id: 'search', action: 'Search', keys: 'Cmd+K', enabled: true },
    { id: 'toggle-theme', action: 'Toggle Theme', keys: 'Cmd+Shift+T', enabled: true },
    { id: 'settings', action: 'Open Settings', keys: 'Cmd+,', enabled: true },
  ],
  terminal: {
    maxInputRows: 4,
    lineHeight: 20,
    scrollbackLines: 5000,
  },
  panel: {
    defaultHeight: 300,
    minHeight: 150,
    maxHeight: 600,
    collapsedHeight: 40,
  },
  gestures: {
    swipeEnabled: true,
    swipeThreshold: 50,
    swipeVelocityThreshold: 0.3,
  },
  advanced: {
    settingsSyncDebounceMs: 500,
    notesDebounceMs: 500,
    messageTimeoutSeconds: 300,
    maxConcurrentTerminals: 5,
    outputBufferIntervalMs: 16,
  },
  workspaceDefaults: {
    defaultColumns: ['Backlog', 'Working', 'Review', 'Done'],
    branchPrefix: 'bentoya/',
    autoStashPrefix: 'bentoya-auto-stash-',
  },
}
