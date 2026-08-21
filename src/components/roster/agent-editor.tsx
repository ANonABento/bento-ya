import { useState } from 'react'
import type { ReactNode } from 'react'
import type { Agent, AgentConfig, AgentRuntime, LlmConfig, ScriptRuntimeConfig } from '@/types'
import { defaultConfigFor, deriveInitials, parseAgentAvatar, parseAgentConfig } from '@/types'
import { useRosterStore } from '@/stores/roster-store'
import * as ipc from '@/lib/ipc'

/**
 * Create/edit modal for an agent.
 *
 * `agent: Agent | null` discriminates create from edit (the `script-editor`
 * pattern); the parent owns the refetch via `onSave`. Duplicate is create with
 * a prefilled `seed`.
 *
 * The form's shape follows the selected runtime, mirroring the dossier — the
 * point of a runtime-typed config is that you never see fields that can't apply.
 *
 * Chrome (header / scrollable body / footer) matches `script-editor.tsx` so the
 * two editors in this app are the same object.
 */

type Props = {
  /** Non-null = editing that agent. Null = creating. */
  agent: Agent | null
  /** Prefill for create (used by Duplicate). */
  seed?: Agent | null
  onSave: () => void
  onCancel: () => void
}

const GRADIENTS: { from: string; to: string }[] = [
  { from: '#10303a', to: '#175f6e' },
  { from: '#3a2a12', to: '#7a4e16' },
  { from: '#241a3a', to: '#3d2a6b' },
  { from: '#2a1420', to: '#6b1f3d' },
  { from: '#122b3a', to: '#1a4a6b' },
]

const inputClass =
  'w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none'

/**
 * One labelled control. Short inputs sit two-up in the form grid; anything
 * that needs room (textareas, lists) takes `full` and spans the row.
 */
function Field({
  label,
  hint,
  full = false,
  children,
}: {
  label: string
  hint?: string
  full?: boolean
  children: ReactNode
}) {
  return (
    <div className={full ? 'sm:col-span-2' : undefined}>
      <label className="mb-1 block text-xs font-medium text-text-secondary">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-text-secondary/70">{hint}</p>}
    </div>
  )
}

/** Group heading inside the form, so twelve controls read as three groups. */
function FormSection({ title }: { title: string }) {
  return (
    <div className="sm:col-span-2">
      <h4 className="border-b border-border-default pb-1.5 text-xs font-semibold uppercase tracking-wider text-text-secondary/70">
        {title}
      </h4>
    </div>
  )
}

/** Newline-separated text <-> string[], so lists stay editable as plain text. */
const linesToList = (v: string) =>
  v
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)

/** "KEY=value" lines <-> env record. */
function linesToEnv(v: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of linesToList(v)) {
    const eq = line.indexOf('=')
    if (eq > 0) out[line.slice(0, eq).trim()] = line.slice(eq + 1).trim()
  }
  return out
}

const envToLines = (env: Record<string, string>) =>
  Object.entries(env)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n')

export function AgentEditor({ agent, seed, onSave, onCancel }: Props) {
  const source = agent ?? seed ?? null
  const skills = useRosterStore((s) => s.skills)
  const runtimes = useRosterStore((s) => s.runtimes)

  const [name, setName] = useState(source ? (agent ? source.name : `${source.name} copy`) : '')
  const [role, setRole] = useState(source?.role ?? '')
  const [runtime, setRuntime] = useState<AgentRuntime>(source?.runtime ?? 'claude')
  const [config, setConfig] = useState<AgentConfig>(
    source ? parseAgentConfig(source.config, source.runtime) : defaultConfigFor('claude'),
  )
  const [gradient, setGradient] = useState(() => {
    if (!source) return GRADIENTS[0]
    const a = parseAgentAvatar(source.avatar, source.name)
    return { from: a.gradientFrom, to: a.gradientTo }
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Switching runtime replaces the config wholesale rather than merging: the
  // shapes genuinely differ, and carrying a stale `command` into an LLM agent
  // would write a config the backend rejects.
  const changeRuntime = (next: AgentRuntime) => {
    setRuntime(next)
    setConfig(defaultConfigFor(next))
  }

  const llm = config.runtime === 'script' ? null : config
  const script = config.runtime === 'script' ? config : null

  const patchLlm = (patch: Partial<LlmConfig>) => {
    setConfig((c) => (c.runtime === 'script' ? c : { ...c, ...patch }))
  }
  const patchScript = (patch: Partial<ScriptRuntimeConfig>) => {
    setConfig((c) => (c.runtime === 'script' ? { ...c, ...patch } : c))
  }

  const handleSave = async () => {
    if (!name.trim()) {
      setError('Name is required')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const configJson = JSON.stringify(config)
      const avatarJson = JSON.stringify({
        initials: deriveInitials(name),
        gradientFrom: gradient?.from ?? GRADIENTS[0]?.from ?? '#10303a',
        gradientTo: gradient?.to ?? GRADIENTS[0]?.to ?? '#175f6e',
      })
      if (agent) {
        await ipc.updateAgent(agent.id, {
          name: name.trim(),
          role: role.trim(),
          runtime,
          config: configJson,
          avatar: avatarJson,
        })
      } else {
        await ipc.createAgent(name.trim(), role.trim(), runtime, configJson, avatarJson)
      }
      onSave()
    } catch (err) {
      // Surface the backend's validation message verbatim — it explains things
      // the form can't infer (e.g. a tool allow-list needing an MCP config).
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const runtimeOptions =
    runtimes.length > 0
      ? runtimes
      : [
          { kind: 'claude' as const, label: 'Claude' },
          { kind: 'codex' as const, label: 'Codex' },
          { kind: 'script' as const, label: 'Script' },
        ]

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel()
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={agent ? 'Edit agent' : 'New agent'}
        data-testid="agent-editor"
        className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-xl border border-border-default bg-bg shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-default px-5 py-4">
          <h3 className="text-base font-semibold text-text-primary">
            {agent ? 'Edit agent' : 'New agent'}
          </h3>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            style={{ cursor: 'pointer' }}
            className="rounded p-1 text-text-secondary transition-colors hover:bg-surface hover:text-text-primary"
          >
            <svg viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4" aria-hidden="true">
              <path d="M5.28 4.22a.75.75 0 0 0-1.06 1.06L6.94 8l-2.72 2.72a.75.75 0 1 0 1.06 1.06L8 9.06l2.72 2.72a.75.75 0 1 0 1.06-1.06L9.06 8l2.72-2.72a.75.75 0 0 0-1.06-1.06L8 6.94 5.28 4.22Z" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto p-5">
          <div className="grid gap-x-4 gap-y-4 sm:grid-cols-2">
            <FormSection title="Identity" />
            <Field label="Name">
              <input
                className={inputClass}
                value={name}
                onChange={(e) => {
                  setName(e.target.value)
                }}
                placeholder="e.g. Code Smith"
                autoFocus
                data-testid="agent-name-input"
              />
            </Field>

            <Field label="What it does">
              <input
                className={inputClass}
                value={role}
                onChange={(e) => {
                  setRole(e.target.value)
                }}
                placeholder="e.g. Implements the task in its worktree"
              />
            </Field>

            <Field label="Runtime">
              <select
                className={inputClass}
                value={runtime}
                onChange={(e) => {
                  changeRuntime(e.target.value as AgentRuntime)
                }}
                data-testid="agent-runtime-select"
                style={{ cursor: 'pointer' }}
              >
                {runtimeOptions.map((r) => (
                  <option key={r.kind} value={r.kind}>
                    {r.label}
                  </option>
                ))}
              </select>
            </Field>

            {llm && (
              <Field label="Model" hint="Leave blank to use the CLI's default.">
                <input
                  className={inputClass}
                  value={llm.model}
                  onChange={(e) => {
                    patchLlm({ model: e.target.value })
                  }}
                  placeholder="e.g. opus"
                />
              </Field>
            )}

            <Field label="Portrait" full>
              <div className="flex gap-2">
                {GRADIENTS.map((g) => (
                  <button
                    key={g.from}
                    type="button"
                    onClick={() => {
                      setGradient(g)
                    }}
                    aria-label={`Portrait colour ${g.from}`}
                    aria-pressed={gradient?.from === g.from}
                    style={{
                      cursor: 'pointer',
                      background: `linear-gradient(140deg, ${g.from}, ${g.to})`,
                    }}
                    className={`h-8 w-8 rounded-lg border-2 transition-colors ${
                      gradient?.from === g.from ? 'border-accent' : 'border-transparent'
                    }`}
                  />
                ))}
              </div>
            </Field>

            {llm && (
              <>
                <FormSection title="Behaviour" />
                <Field label="System prompt" full>
                  <textarea
                    className={`${inputClass} min-h-20 resize-y`}
                    value={llm.systemPrompt}
                    onChange={(e) => {
                      patchLlm({ systemPrompt: e.target.value })
                    }}
                    placeholder="e.g. Implement the task described in .task.md"
                  />
                </Field>

                <FormSection title="Tools" />
                <Field label="MCP config path" full>
                  <input
                    className={inputClass}
                    value={llm.mcpConfigPath}
                    onChange={(e) => {
                      patchLlm({ mcpConfigPath: e.target.value })
                    }}
                    placeholder="e.g. /path/to/mcp.json"
                  />
                </Field>

                <Field
                  label="Allowed tools"
                  hint="One per line. Only applies when an MCP config is set."
                  full
                >
                  <textarea
                    className={`${inputClass} min-h-16 resize-y font-mono text-xs`}
                    value={llm.allowedTools.join('\n')}
                    onChange={(e) => {
                      patchLlm({ allowedTools: linesToList(e.target.value) })
                    }}
                  />
                </Field>

                <Field label="Skills" full>
                  {skills.length === 0 ? (
                    <p className="text-xs text-text-secondary">
                      No skills defined yet. Add them in Settings → Skills.
                    </p>
                  ) : (
                    <div className="flex flex-col gap-1.5">
                      {skills.map((s) => {
                        const checked = llm.skillIds.includes(s.id)
                        return (
                          <label
                            key={s.id}
                            className="flex items-center gap-2 text-sm text-text-primary"
                            style={{ cursor: 'pointer' }}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() => {
                                patchLlm({
                                  skillIds: checked
                                    ? llm.skillIds.filter((id) => id !== s.id)
                                    : [...llm.skillIds, s.id],
                                })
                              }}
                              className="h-3.5 w-3.5 rounded accent-accent"
                            />
                            {s.name}
                          </label>
                        )
                      })}
                    </div>
                  )}
                </Field>
              </>
            )}

            {script && (
              <>
                <FormSection title="Execution" />
                <Field label="Command" full>
                  <input
                    className={inputClass}
                    value={script.command}
                    onChange={(e) => {
                      patchScript({ command: e.target.value })
                    }}
                    placeholder="e.g. ./render.sh"
                    data-testid="agent-command-input"
                  />
                </Field>

                <Field label="Arguments" hint="One per line." full>
                  <textarea
                    className={`${inputClass} min-h-16 resize-y font-mono text-xs`}
                    value={script.args.join('\n')}
                    onChange={(e) => {
                      patchScript({ args: linesToList(e.target.value) })
                    }}
                  />
                </Field>

                <Field label="Environment" hint="One KEY=value per line." full>
                  <textarea
                    className={`${inputClass} min-h-16 resize-y font-mono text-xs`}
                    value={envToLines(script.env)}
                    onChange={(e) => {
                      patchScript({ env: linesToEnv(e.target.value) })
                    }}
                  />
                </Field>
              </>
            )}

            {error && (
              <p className="rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-xs text-error sm:col-span-2">
                {error}
              </p>
            )}
          </div>
        </div>

        {/* Footer actions */}
        <div className="flex justify-end gap-2 border-t border-border-default px-5 py-3">
          <button
            type="button"
            onClick={onCancel}
            style={{ cursor: 'pointer' }}
            className="rounded-lg border border-border-default px-4 py-2 text-sm text-text-secondary transition-colors hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => {
              void handleSave()
            }}
            disabled={saving}
            data-testid="agent-save"
            style={{ cursor: 'pointer' }}
            className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg transition-opacity disabled:opacity-50"
          >
            {saving ? 'Saving…' : agent ? 'Save agent' : 'Create agent'}
          </button>
        </div>
      </div>
    </div>
  )
}
