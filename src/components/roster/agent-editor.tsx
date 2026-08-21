import { useState } from 'react'
import type { Agent, AgentConfig, AgentRuntime, LlmConfig, ScriptRuntimeConfig } from '@/types'
import { defaultConfigFor, deriveInitials, parseAgentAvatar, parseAgentConfig } from '@/types'
import { useRosterStore } from '@/stores/roster-store'
import * as ipc from '@/lib/ipc'

/**
 * Create/edit modal for an agent.
 *
 * `agent: Agent | null` discriminates create from edit (the script-editor
 * pattern); the parent owns the refetch via `onSave`. Duplicate is create with
 * a prefilled `seed`.
 *
 * The form's shape follows the selected runtime, mirroring the dossier — that
 * is the whole point of the runtime-typed config.
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mb-3 block">
      <span className="mb-1 block text-xs font-medium text-text-secondary">{label}</span>
      {children}
    </label>
  )
}

const inputClass =
  'w-full rounded-md border border-border-default bg-surface px-2.5 py-1.5 text-[13px] text-text-primary outline-none focus:border-accent'

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

  const [name, setName] = useState(
    source ? (agent ? source.name : `${source.name} copy`) : '',
  )
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
      // Surface the backend's validation message verbatim — it explains
      // things the form can't infer (e.g. a tool allow-list needing an MCP
      // config to apply to).
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

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
        className="flex max-h-[85vh] w-full max-w-lg flex-col overflow-y-auto rounded-xl border border-border-default bg-bg p-5 shadow-2xl"
      >
        <h3 className="mb-4 text-base font-semibold text-text-primary">
          {agent ? 'Edit agent' : 'New agent'}
        </h3>

        <Field label="Name">
          <input
            className={inputClass}
            value={name}
            onChange={(e) => {
              setName(e.target.value)
            }}
            placeholder="Code Smith"
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
            placeholder="Implements the task in its worktree"
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
            {(runtimes.length > 0
              ? runtimes
              : [
                  { kind: 'claude' as const, label: 'Claude' },
                  { kind: 'codex' as const, label: 'Codex' },
                  { kind: 'script' as const, label: 'Script' },
                ]
            ).map((r) => (
              <option key={r.kind} value={r.kind}>
                {r.label}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Portrait">
          <div className="flex gap-2">
            {GRADIENTS.map((g) => (
              <button
                key={g.from}
                type="button"
                onClick={() => {
                  setGradient(g)
                }}
                aria-label={`Portrait colour ${g.from}`}
                style={{
                  cursor: 'pointer',
                  background: `linear-gradient(140deg, ${g.from}, ${g.to})`,
                }}
                className={`h-8 w-8 rounded-md border-2 ${
                  gradient?.from === g.from ? 'border-accent' : 'border-transparent'
                }`}
              />
            ))}
          </div>
        </Field>

        {llm && (
          <>
            <Field label="System prompt">
              <textarea
                className={`${inputClass} min-h-20 resize-y`}
                value={llm.systemPrompt}
                onChange={(e) => {
                  patchLlm({ systemPrompt: e.target.value })
                }}
                placeholder="You implement the task described in .task.md"
              />
            </Field>
            <Field label="Model (blank = CLI default)">
              <input
                className={inputClass}
                value={llm.model}
                onChange={(e) => {
                  patchLlm({ model: e.target.value })
                }}
                placeholder="opus"
              />
            </Field>
            <Field label="MCP config path">
              <input
                className={inputClass}
                value={llm.mcpConfigPath}
                onChange={(e) => {
                  patchLlm({ mcpConfigPath: e.target.value })
                }}
                placeholder="/path/to/mcp.json"
              />
            </Field>
            <Field label="Allowed tools (one per line — needs an MCP config)">
              <textarea
                className={`${inputClass} min-h-16 resize-y font-mono text-xs`}
                value={llm.allowedTools.join('\n')}
                onChange={(e) => {
                  patchLlm({ allowedTools: linesToList(e.target.value) })
                }}
              />
            </Field>
            <Field label="Skills">
              {skills.length === 0 ? (
                <p className="text-xs italic text-text-secondary">
                  No skills defined yet — create them in Settings → Skills.
                </p>
              ) : (
                <div className="flex flex-col gap-1">
                  {skills.map((s) => {
                    const checked = llm.skillIds.includes(s.id)
                    return (
                      <label key={s.id} className="flex items-center gap-2 text-[13px]">
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
                        />
                        <span className="text-text-primary">{s.name}</span>
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
            <Field label="Command">
              <input
                className={inputClass}
                value={script.command}
                onChange={(e) => {
                  patchScript({ command: e.target.value })
                }}
                placeholder="./render.sh"
                data-testid="agent-command-input"
              />
            </Field>
            <Field label="Arguments (one per line)">
              <textarea
                className={`${inputClass} min-h-16 resize-y font-mono text-xs`}
                value={script.args.join('\n')}
                onChange={(e) => {
                  patchScript({ args: linesToList(e.target.value) })
                }}
              />
            </Field>
            <Field label="Environment (KEY=value, one per line)">
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
          <p className="mb-3 rounded-md border border-error/40 bg-error/10 px-2.5 py-1.5 text-xs text-error">
            {error}
          </p>
        )}

        <div className="mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            style={{ cursor: 'pointer' }}
            className="rounded-lg border border-border-default px-3 py-1.5 text-[13px] text-text-primary hover:bg-surface-hover"
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
            className="rounded-lg bg-accent px-3 py-1.5 text-[13px] font-semibold text-bg disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  )
}
