import type { ReactNode } from 'react'
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
 * Slots that aren't wired yet render visibly disabled with a `v2` tag rather
 * than being hidden, so the dossier stays honest about what the app can
 * actually do today.
 */

function Row({
  label,
  children,
  v2 = false,
}: {
  label: string
  children: ReactNode
  v2?: boolean
}) {
  return (
    <div
      className={`flex items-start gap-3 border-b border-border-default py-2 ${v2 ? 'opacity-50' : ''}`}
    >
      <span className="w-16 shrink-0 pt-0.5 font-mono text-[11px] text-text-secondary">
        {label}
      </span>
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 text-sm text-text-primary">
        {children}
      </span>
      {v2 && (
        <span className="mt-0.5 shrink-0 rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
          v2
        </span>
      )}
    </div>
  )
}

function Token({ children }: { children: ReactNode }) {
  return (
    <span className="rounded border border-border-default bg-surface px-1.5 py-0.5 font-mono text-[11px] text-text-primary">
      {children}
    </span>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <span className="text-sm text-text-secondary">{children}</span>
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-1 mt-5 text-[10px] font-semibold uppercase tracking-wider text-text-secondary/70">
      {children}
    </div>
  )
}

function LlmBlock({ config }: { config: LlmConfig }) {
  const resolveSkills = useRosterStore((s) => s.resolveSkills)
  const skills = resolveSkills(config.skillIds)

  return (
    <>
      <SectionLabel>Configuration</SectionLabel>
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
        {config.mcpConfigPath ? <Token>{config.mcpConfigPath}</Token> : <Empty>Not set</Empty>}
      </Row>
      <Row label="tools">
        {config.allowedTools.length > 0 ? (
          config.allowedTools.map((t) => <Token key={t}>{t}</Token>)
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
                className="rounded bg-error/10 px-1.5 py-0.5 text-[10px] font-medium text-error"
              >
                Missing skill
              </span>
            ),
          )
        ) : (
          <Empty>None attached</Empty>
        )}
      </Row>
      <Row label="rag" v2>
        <Empty>Retrieval lands in a later phase.</Empty>
      </Row>
    </>
  )
}

function ScriptBlock({ config }: { config: ScriptRuntimeConfig }) {
  const envEntries = Object.entries(config.env)
  return (
    <>
      <SectionLabel>Configuration</SectionLabel>
      <Row label="command">
        {config.command ? <Token>{config.command}</Token> : <Empty>Not set</Empty>}
      </Row>
      <Row label="args">
        {config.args.length > 0 ? (
          config.args.map((a, i) => <Token key={`${a}-${String(i)}`}>{a}</Token>)
        ) : (
          <Empty>None</Empty>
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
          <Empty>None</Empty>
        )}
      </Row>
      <Row label="outputs" v2>
        <Empty>Typed artifacts land in a later phase.</Empty>
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
    <div className="flex flex-col p-6 lg:h-full" data-testid="agent-dossier">
      <div
        className="flex h-24 w-full max-w-[380px] shrink-0 items-center justify-center rounded-lg"
        style={{
          background: `linear-gradient(140deg, ${avatar.gradientFrom}, ${avatar.gradientTo})`,
        }}
      >
        <span className="font-mono text-4xl font-bold text-white">{avatar.initials}</span>
      </div>

      <h3 className="mt-4 text-base font-semibold text-text-primary">{agent.name}</h3>
      <p className="mt-0.5 text-xs text-text-secondary">{agent.role || 'No description yet.'}</p>
      <span className="mt-3 self-start rounded bg-surface-hover px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-text-secondary">
        {agent.runtime}
      </span>

      {config.runtime === 'script' ? <ScriptBlock config={config} /> : <LlmBlock config={config} />}

      <div className="mt-6 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onEdit}
          data-testid="agent-edit"
          style={{ cursor: 'pointer' }}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg transition-opacity hover:opacity-90"
        >
          Edit
        </button>
        <button
          type="button"
          onClick={onDuplicate}
          data-testid="agent-duplicate"
          style={{ cursor: 'pointer' }}
          className="rounded-lg border border-border-default px-4 py-2 text-sm text-text-secondary transition-colors hover:text-text-primary"
        >
          Duplicate
        </button>
        <button
          type="button"
          onClick={onDelete}
          data-testid="agent-delete"
          style={{ cursor: 'pointer' }}
          className="rounded-lg border border-border-default px-4 py-2 text-sm text-error transition-colors hover:bg-error/10"
        >
          Delete
        </button>
      </div>
    </div>
  )
}
