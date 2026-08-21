// ─── Roster Types (Kaiten Agents) ──────────────────────────────────────────
//
// An `Agent` here is a DEFINITION you craft once — not a running process.
// The running-process types live in `types/agent.ts` (AgentSession, AgentMessage).
// Spec: .tickets/_docs/specs/KAITEN_AGENTS.md

export type AgentRuntime = 'claude' | 'codex' | 'script'

/** Config for an LLM-backed agent (claude or codex). */
export interface LlmConfig {
  runtime: 'claude' | 'codex'
  systemPrompt: string
  /** opus | sonnet | haiku for claude, a model id for codex. '' = CLI default. */
  model: string
  /** Path to an MCP config file passed through as --mcp-config. */
  mcpConfigPath: string
  /** Tool allow-list, only meaningful alongside mcpConfigPath. */
  allowedTools: string[]
  /** Ids into the skills table. Dangling ids render as "missing skill". */
  skillIds: string[]
}

/** Config for the generic script runtime. */
export interface ScriptRuntimeConfig {
  runtime: 'script'
  command: string
  args: string[]
  env: Record<string, string>
}

/**
 * The runtime-typed config stored as JSON in `agents.config`.
 *
 * Discriminated on `runtime`, which is what lets the dossier switch shape
 * rather than showing one flat form with irrelevant fields greyed out.
 */
export type AgentConfig = LlmConfig | ScriptRuntimeConfig

export interface AgentAvatar {
  initials: string
  gradientFrom: string
  gradientTo: string
}

export interface Agent {
  id: string
  name: string
  /** One-line "what it does". */
  role: string
  runtime: AgentRuntime
  /** JSON string of AgentConfig — parse with parseAgentConfig. */
  config: string
  /** JSON string of AgentAvatar — parse with parseAgentAvatar. */
  avatar: string
  createdAt: string
  updatedAt: string
}

export interface Skill {
  id: string
  name: string
  description: string
  trigger: string
  script: string
  createdAt: string
  updatedAt: string
}

/** What a runtime tells the UI about itself, from `list_agent_runtimes`. */
export interface RuntimeDescriptor {
  kind: AgentRuntime
  label: string
  usesLlmFields: boolean
  usesScriptFields: boolean
}

export const DEFAULT_LLM_CONFIG: Omit<LlmConfig, 'runtime'> = {
  systemPrompt: '',
  model: '',
  mcpConfigPath: '',
  allowedTools: [],
  skillIds: [],
}

export const DEFAULT_SCRIPT_CONFIG: Omit<ScriptRuntimeConfig, 'runtime'> = {
  command: '',
  args: [],
  env: {},
}

/** An empty config for a runtime, for the "new agent" form. */
export function defaultConfigFor(runtime: AgentRuntime): AgentConfig {
  return runtime === 'script'
    ? { runtime: 'script', ...DEFAULT_SCRIPT_CONFIG }
    : { runtime, ...DEFAULT_LLM_CONFIG }
}

/**
 * Parse a stored config blob, falling back to an empty config for the agent's
 * declared runtime.
 *
 * Never throws: a roster that refuses to render because one agent has a
 * malformed blob would be worse than showing that agent with empty fields.
 */
export function parseAgentConfig(configJson: string, runtime: AgentRuntime): AgentConfig {
  try {
    const parsed = JSON.parse(configJson) as Partial<AgentConfig> | null
    if (!parsed || typeof parsed !== 'object' || parsed.runtime !== runtime) {
      return defaultConfigFor(runtime)
    }
    // Merge over defaults so a config written by an older build (missing a
    // field added since) still yields a complete object.
    return runtime === 'script'
      ? { ...DEFAULT_SCRIPT_CONFIG, ...(parsed as ScriptRuntimeConfig), runtime: 'script' }
      : { ...DEFAULT_LLM_CONFIG, ...(parsed as LlmConfig), runtime }
  } catch {
    return defaultConfigFor(runtime)
  }
}

export function parseAgentAvatar(avatarJson: string, name: string): AgentAvatar {
  const fallback: AgentAvatar = {
    initials: deriveInitials(name),
    gradientFrom: '#10303a',
    gradientTo: '#175f6e',
  }
  try {
    const parsed = JSON.parse(avatarJson) as Partial<AgentAvatar> | null
    if (!parsed || typeof parsed !== 'object') return fallback
    return { ...fallback, ...parsed }
  } catch {
    return fallback
  }
}

/** "Code Smith" -> "CS", "Reviewer" -> "RE". */
export function deriveInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean)
  const [first, second] = words
  if (!first) return '??'
  if (!second) return first.slice(0, 2).toUpperCase()
  return (first.slice(0, 1) + second.slice(0, 1)).toUpperCase()
}
