import { useState, type ReactNode } from 'react'
import type { Agent, LlmConfig, ScriptRuntimeConfig } from '@/types'
import { parseAgentAvatar, parseAgentConfig } from '@/types'
import { useRosterStore } from '@/stores/roster-store'

/**
 * The runtime-typed dossier — the load-bearing idea of the roster.
 *
 * Universal identity across the top, then configuration grouped into cards
 * whose *set* is chosen by the agent's runtime: a script agent gets
 * command/arguments/environment; an LLM agent gets instructions/model/tools/
 * skills. Grouping beats one flat key-value list because these fields are not
 * peers — a system prompt is prose, a model is a token, an MCP path is a
 * filesystem path you'll want to copy elsewhere.
 *
 * Cards that can't do anything yet are shown disabled with a `v2` tag rather
 * than hidden, so the dossier stays honest about what the app can do today.
 */

function Section({
  title,
  count,
  wide = false,
  v2 = false,
  children,
}: {
  title: string
  count?: number
  /** Span both columns — for prose, which reads badly in a narrow column. */
  wide?: boolean
  v2?: boolean
  children: ReactNode
}) {
  return (
    <section
      className={`rounded-lg border border-border-default bg-surface ${wide ? 'xl:col-span-2' : ''} ${
        v2 ? 'opacity-60' : ''
      }`}
    >
      <header className="flex items-center gap-2 border-b border-border-default px-4 py-2.5">
        <h4 className="text-xs font-semibold text-text-primary">{title}</h4>
        {count !== undefined && count > 0 && (
          <span className="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] font-medium text-text-secondary">
            {count}
          </span>
        )}
        {v2 && (
          <span className="ml-auto rounded bg-accent/10 px-1.5 py-0.5 text-[10px] font-medium text-accent">
            v2
          </span>
        )}
      </header>
      <div className="px-4 py-3">{children}</div>
    </section>
  )
}

/**
 * A monospace value. Paths, commands and tool ids get click-to-copy, because
 * those are things people paste somewhere else.
 */
function CodeValue({ value, copyable = false }: { value: string; copyable?: boolean }) {
  const [copied, setCopied] = useState(false)

  if (!copyable) {
    return (
      <span className="rounded border border-border-default bg-bg px-1.5 py-0.5 font-mono text-[11px] text-text-primary">
        {value}
      </span>
    )
  }

  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard
          .writeText(value)
          .then(() => {
            setCopied(true)
            window.setTimeout(() => {
              setCopied(false)
            }, 1200)
          })
          .catch(() => {
            // Clipboard access can be denied; the value stays readable on screen.
          })
      }}
      title="Copy"
      style={{ cursor: 'pointer' }}
      className="group inline-flex max-w-full items-center gap-1.5 rounded border border-border-default bg-bg px-1.5 py-0.5 font-mono text-[11px] text-text-primary transition-colors hover:border-text-secondary"
    >
      <span className="truncate">{value}</span>
      <span className="shrink-0">
        {copied ? (
          <svg viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3 text-success">
            <path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-6.5 6.5a.75.75 0 0 1-1.06 0l-3-3a.75.75 0 1 1 1.06-1.06L6.75 10.19l5.97-5.97a.75.75 0 0 1 1.06 0Z" />
          </svg>
        ) : (
          <svg
            viewBox="0 0 16 16"
            fill="currentColor"
            className="h-3 w-3 text-text-secondary opacity-0 transition-opacity group-hover:opacity-100"
          >
            <path d="M3.5 2A1.5 1.5 0 0 0 2 3.5v7A1.5 1.5 0 0 0 3.5 12H5v1.5A1.5 1.5 0 0 0 6.5 15h6a1.5 1.5 0 0 0 1.5-1.5v-7A1.5 1.5 0 0 0 12.5 5H11V3.5A1.5 1.5 0 0 0 9.5 2h-6Zm7.5 4V3.5a.5.5 0 0 0-.5-.5h-6a.5.5 0 0 0-.5.5v7a.5.5 0 0 0 .5.5H5V6.5A1.5 1.5 0 0 1 6.5 5H11Z" />
          </svg>
        )}
      </span>
    </button>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="text-sm text-text-secondary">{children}</p>
}

/** Label/value pair inside a card, for fields that genuinely are peers. */
function Field({
  label,
  wideLabel = false,
  children,
}: {
  label: string
  /** For env var names and other long keys that shouldn't truncate. */
  wideLabel?: boolean
  children: ReactNode
}) {
  return (
    <div className="flex items-baseline gap-3 py-1">
      <span
        className={`${wideLabel ? 'w-40' : 'w-28'} shrink-0 truncate font-mono text-[11px] text-text-secondary`}
        title={label}
      >
        {label}
      </span>
      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">{children}</span>
    </div>
  )
}

function LlmSections({ config }: { config: LlmConfig }) {
  const resolveSkills = useRosterStore((s) => s.resolveSkills)
  const skills = resolveSkills(config.skillIds)

  return (
    <>
      <Section title="Instructions" wide>
        {config.systemPrompt ? (
          // Prose gets a measure cap: the pane is wide enough to run ~150
          // characters per line, which is well past comfortable reading.
          <p className="max-w-prose whitespace-pre-wrap break-words text-sm leading-relaxed text-text-primary">
            {config.systemPrompt}
          </p>
        ) : (
          <Empty>No system prompt. The CLI&apos;s own default applies.</Empty>
        )}
      </Section>

      <Section title="Model">
        <Field label="Model">
          {config.model ? (
            <CodeValue value={config.model} />
          ) : (
            <span className="text-sm text-text-secondary">CLI default</span>
          )}
        </Field>
        <Field label="Runtime">
          <CodeValue value={config.runtime} />
        </Field>
      </Section>

      <Section title="Tools" count={config.allowedTools.length}>
        <Field label="MCP config">
          {config.mcpConfigPath ? (
            <CodeValue value={config.mcpConfigPath} copyable />
          ) : (
            <span className="text-sm text-text-secondary">Not set</span>
          )}
        </Field>
        <Field label="Allowed">
          {config.allowedTools.length > 0 ? (
            config.allowedTools.map((t) => <CodeValue key={t} value={t} copyable />)
          ) : (
            <span className="text-sm text-text-secondary">
              {config.mcpConfigPath ? 'All tools' : 'All tools (no MCP configured)'}
            </span>
          )}
        </Field>
      </Section>

      <Section title="Skills" count={skills.length}>
        {skills.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {skills.map((skill, i) =>
              skill ? (
                <span
                  key={skill.id}
                  className="rounded bg-surface-hover px-2 py-0.5 text-xs text-text-primary"
                  title={skill.description || undefined}
                >
                  {skill.name}
                </span>
              ) : (
                // A skill can be deleted while agents still reference it. Say
                // so rather than silently dropping it from the list.
                <span
                  key={`missing-${String(i)}`}
                  className="rounded bg-error/10 px-2 py-0.5 text-xs font-medium text-error"
                  title="This skill no longer exists. Edit the agent to detach it."
                >
                  Missing skill
                </span>
              ),
            )}
          </div>
        ) : (
          <Empty>None attached.</Empty>
        )}
      </Section>

      <Section title="Retrieval" v2>
        <Empty>Giving an agent its own document set lands in a later phase.</Empty>
      </Section>
    </>
  )
}

function ScriptSections({ config }: { config: ScriptRuntimeConfig }) {
  const envEntries = Object.entries(config.env)
  return (
    <>
      <Section title="Command" count={config.args.length} wide>
        {config.command ? (
          // One line, exactly what gets run, copyable. Listing each argument
          // separately as well said the same thing twice.
          <CodeValue value={[config.command, ...config.args].join(' ')} copyable />
        ) : (
          <Empty>No command set. This agent can&apos;t run until one is.</Empty>
        )}
      </Section>

      <Section title="Environment" count={envEntries.length}>
        {envEntries.length > 0 ? (
          <div className="flex flex-col gap-1">
            {envEntries.map(([k, v]) => (
              <Field key={k} label={k} wideLabel>
                <CodeValue value={v} />
              </Field>
            ))}
          </div>
        ) : (
          <Empty>No overrides. The agent inherits the app&apos;s environment.</Empty>
        )}
      </Section>

      <Section title="Outputs" v2>
        <Empty>Typed artifacts a downstream agent can consume land in a later phase.</Empty>
      </Section>
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
    <div className="flex h-full flex-col overflow-y-auto" data-testid="agent-dossier">
      {/* Identity band — portrait beside the name rather than above it, so the
          wider pane doesn't carry a stretched banner across the top. */}
      <div className="flex items-center gap-4 border-b border-border-default px-6 py-4">
        <div
          className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg"
          style={{
            background: `linear-gradient(140deg, ${avatar.gradientFrom}, ${avatar.gradientTo})`,
          }}
        >
          <span className="font-mono text-lg font-bold text-white">{avatar.initials}</span>
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-semibold text-text-primary">{agent.name}</h3>
          <p className="mt-0.5 truncate text-xs text-text-secondary">
            {agent.role || 'No description yet.'}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
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
            aria-label="Delete agent"
            title="Delete agent"
            data-testid="agent-delete"
            style={{ cursor: 'pointer' }}
            className="rounded-lg border border-border-default p-2 text-text-secondary transition-colors hover:border-error/40 hover:text-error"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
              <path
                fillRule="evenodd"
                d="M8.75 1a.75.75 0 0 0-.75.75V3h-3.5a.75.75 0 0 0 0 1.5h11a.75.75 0 0 0 0-1.5H12V1.75a.75.75 0 0 0-.75-.75h-2.5ZM5.06 6l.66 9.26A2 2 0 0 0 7.71 17h4.58a2 2 0 0 0 1.99-1.74L14.94 6H5.06Z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex-1 px-6 py-5">
        <div className="grid items-start gap-3 xl:grid-cols-2">
          {config.runtime === 'script' ? (
            <ScriptSections config={config} />
          ) : (
            <LlmSections config={config} />
          )}
        </div>
      </div>
    </div>
  )
}
