import type { Agent, LlmConfig, ScriptRuntimeConfig } from '@/types'
import { parseAgentAvatar, parseAgentConfig } from '@/types'
import { useRosterStore } from '@/stores/roster-store'

/**
 * The runtime-typed dossier — the load-bearing idea of the roster.
 *
 * Universal fields up top, then a block whose *shape* is chosen by the agent's
 * runtime: a script agent shows command/args/env; an LLM agent swaps those for
 * system prompt / model / MCP set / skills.
 *
 * Slots we can't honour yet render visibly disabled with a `v2` tag rather than
 * being hidden, so the dossier is honest about what is and isn't wired.
 */

function Row({
  label,
  children,
  muted = false,
  v2 = false,
}: {
  label: string
  children: React.ReactNode
  muted?: boolean
  v2?: boolean
}) {
  return (
    <div
      className={`flex items-start gap-3 border-b border-border-default/60 py-2 ${v2 ? 'opacity-50' : ''}`}
    >
      <span className="w-24 shrink-0 pt-0.5 font-mono text-[11px] text-text-secondary">
        {label}
      </span>
      <span
        className={`flex min-w-0 flex-wrap items-center gap-1.5 text-[13px] ${muted ? 'text-text-secondary' : 'text-text-primary'}`}
      >
        {children}
      </span>
      {v2 && (
        <span className="ml-auto shrink-0 rounded border border-accent/50 px-1.5 font-mono text-[9px] text-accent">
          v2
        </span>
      )}
    </div>
  )
}

function Token({ children, tone }: { children: React.ReactNode; tone?: 'muted' }) {
  return (
    <span
      className={`rounded border border-border-default bg-surface-hover px-1.5 py-0.5 font-mono text-[10.5px] ${
        tone === 'muted' ? 'text-text-secondary' : 'text-text-primary'
      }`}
    >
      {children}
    </span>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <span className="text-[13px] italic text-text-secondary">{children}</span>
}

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 mt-4 font-mono text-[10px] font-semibold uppercase tracking-wider text-text-secondary/70">
      {children}
    </div>
  )
}

function LlmBlock({ config }: { config: LlmConfig }) {
  const resolveSkills = useRosterStore((s) => s.resolveSkills)
  const skills = resolveSkills(config.skillIds)

  return (
    <>
      <SectionLabel>Runtime config · {config.runtime}</SectionLabel>
      <Row label="prompt">
        {config.systemPrompt ? (
          <span className="whitespace-pre-wrap break-words">{config.systemPrompt}</span>
        ) : (
          <Empty>No system prompt — the CLI default applies.</Empty>
        )}
      </Row>
      <Row label="model">
        {config.model ? <Token>{config.model}</Token> : <Empty>CLI default</Empty>}
      </Row>
      <Row label="mcp">
        {config.mcpConfigPath ? (
          <Token>{config.mcpConfigPath}</Token>
        ) : (
          <Empty>No MCP config</Empty>
        )}
      </Row>
      <Row label="tools">
        {config.allowedTools.length > 0 ? (
          config.allowedTools.map((t) => (
            <Token key={t} tone="muted">
              {t}
            </Token>
          ))
        ) : (
          <Empty>All tools allowed</Empty>
        )}
      </Row>
      <Row label="skills">
        {skills.length > 0 ? (
          skills.map((skill, i) =>
            skill ? (
              <Token key={skill.id}>{skill.name}</Token>
            ) : (
              // A skill can be deleted while agents still reference it. Say so
              // rather than silently dropping it from the list.
              <span
                key={`missing-${String(i)}`}
                className="rounded border border-error/50 px-1.5 py-0.5 font-mono text-[10.5px] text-error"
              >
                missing skill
              </span>
            ),
          )
        ) : (
          <Empty>No skills attached</Empty>
        )}
      </Row>
      <Row label="rag" muted v2>
        <Empty>Retrieval is a later phase.</Empty>
      </Row>
    </>
  )
}

function ScriptBlock({ config }: { config: ScriptRuntimeConfig }) {
  const envEntries = Object.entries(config.env)
  return (
    <>
      <SectionLabel>Runtime config · script</SectionLabel>
      <Row label="command">
        {config.command ? <Token>{config.command}</Token> : <Empty>No command set</Empty>}
      </Row>
      <Row label="args">
        {config.args.length > 0 ? (
          config.args.map((a, i) => (
            <Token key={`${a}-${String(i)}`} tone="muted">
              {a}
            </Token>
          ))
        ) : (
          <Empty>No arguments</Empty>
        )}
      </Row>
      <Row label="env">
        {envEntries.length > 0 ? (
          envEntries.map(([k, v]) => (
            <Token key={k}>
              {k}={v}
            </Token>
          ))
        ) : (
          <Empty>No environment overrides</Empty>
        )}
      </Row>
      <Row label="outputs" muted v2>
        <Empty>Typed artifacts are a later phase.</Empty>
      </Row>
    </>
  )
}

export function AgentDossier({
  agent,
  onEdit,
  onDuplicate,
  onDelete,
}: {
  agent: Agent
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
}) {
  const avatar = parseAgentAvatar(agent.avatar, agent.name)
  const config = parseAgentConfig(agent.config, agent.runtime)

  return (
    <div className="flex h-full flex-col overflow-y-auto p-5" data-testid="agent-dossier">
      <div
        className="relative flex h-24 items-center justify-center overflow-hidden rounded-lg"
        style={{
          background: `linear-gradient(140deg, ${avatar.gradientFrom}, ${avatar.gradientTo})`,
        }}
      >
        <span className="font-mono text-4xl font-extrabold text-white">{avatar.initials}</span>
      </div>

      <h3 className="mt-4 text-xl font-semibold tracking-tight text-text-primary">{agent.name}</h3>
      {agent.role ? (
        <p className="mt-0.5 text-[13px] text-text-secondary">{agent.role}</p>
      ) : (
        <p className="mt-0.5 text-[13px] italic text-text-secondary">No description yet.</p>
      )}
      <span className="mt-3 self-start rounded border border-border-default px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-wider text-text-secondary">
        {agent.runtime} runtime
      </span>

      {config.runtime === 'script' ? (
        <ScriptBlock config={config} />
      ) : (
        <LlmBlock config={config} />
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onEdit}
          data-testid="agent-edit"
          style={{ cursor: 'pointer' }}
          className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-bg transition-opacity hover:opacity-90"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={onDuplicate}
          data-testid="agent-duplicate"
          style={{ cursor: 'pointer' }}
          className="rounded-lg border border-border-default px-3 py-1.5 text-[13px] text-text-primary transition-colors hover:bg-surface-hover"
        >
          Duplicate
        </button>
        <button
          type="button"
          onClick={onDelete}
          data-testid="agent-delete"
          style={{ cursor: 'pointer' }}
          className="rounded-lg border border-border-default px-3 py-1.5 text-[13px] text-error transition-colors hover:bg-error/10"
        >
          Delete
        </button>
      </div>
    </div>
  )
}
