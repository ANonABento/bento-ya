import { useEffect } from 'react'
import type { ActionType, ExitCriteria, ExitCriteriaType, SpawnCliAction, TriggerAction } from '@/types'
import { useRosterStore } from '@/stores/roster-store'
import { CLI_TYPES } from './column-config-constants'
import {
  ACTION_CLAUSES,
  COLUMN_RECIPES,
  EXIT_CLAUSES,
  SENTENCE_MODELS,
  defaultActionForType,
} from './column-recipes'

/**
 * Sentinel for "no roster agent — just run a bare CLI", the pre-agents
 * behaviour. Not the empty string: an empty `<option>` value is easy to
 * confuse with "nothing selected".
 */
const BARE_CLI = '__bare_cli__'

type Props = {
  onEntry: TriggerAction
  setOnEntry: (a: TriggerAction) => void
  exitCriteria: ExitCriteria
  setExitCriteria: (c: ExitCriteria) => void
}

/** An inline dropdown styled to read as a token inside the sentence. */
function Token({
  value,
  onChange,
  options,
  ariaLabel,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
  ariaLabel: string
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => { onChange(e.target.value) }}
      style={{ cursor: 'pointer' }}
      className="mx-0.5 rounded-md border border-accent/30 bg-accent/10 px-1.5 py-0.5 text-sm font-medium text-accent focus:border-accent focus:outline-none"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value} className="bg-surface text-text-primary">
          {o.label}
        </option>
      ))}
    </select>
  )
}

export function AutomationSentence({ onEntry, setOnEntry, exitCriteria, setExitCriteria }: Props) {
  const actionType = onEntry.type
  const spawn = onEntry.type === 'spawn_cli' ? onEntry : null

  const agents = useRosterStore((s) => s.agents)
  const loadRoster = useRosterStore((s) => s.load)
  useEffect(() => { void loadRoster() }, [loadRoster])

  const attachedAgent = spawn?.agent_id
    ? agents.find((a) => a.id === spawn.agent_id)
    : undefined
  const isScriptAgent = attachedAgent?.runtime === 'script'

  const agentOptions = [
    ...agents.map((a) => ({ value: a.id, label: a.name })),
    // An agent the column names but the roster no longer has. Shown rather
    // than silently resetting the column to a bare CLI, which would look like
    // it still worked.
    ...(spawn?.agent_id && !attachedAgent
      ? [{ value: spawn.agent_id, label: 'missing agent' }]
      : []),
    { value: BARE_CLI, label: 'a bare CLI' },
  ]

  // With an agent attached, "auto" no longer means the workspace default — it
  // means whatever the agent asked for. Say so.
  const modelOptionsWithAgentDefault = SENTENCE_MODELS.map((m) =>
    m.value === '' ? { ...m, label: "the agent's model" } : m,
  )

  const setActionType = (t: string) => { setOnEntry(defaultActionForType(t as ActionType)) }
  const setSpawn = (patch: Partial<SpawnCliAction>) => {
    if (onEntry.type === 'spawn_cli') setOnEntry({ ...onEntry, ...patch })
  }
  const setExitType = (t: string) => {
    const type = t as ExitCriteriaType
    // Picking a real condition implies "advance when it's met"; "manual" means
    // it waits for the user. (Power users can override auto_advance in Advanced.)
    setExitCriteria({ ...exitCriteria, type, auto_advance: type !== 'manual' })
  }

  return (
    <div className="space-y-4">
      {/* Recipes */}
      <div>
        <div className="mb-1.5 text-xs font-medium text-text-secondary">Start from a recipe</div>
        <div className="flex flex-wrap gap-1.5">
          {COLUMN_RECIPES.map((r) => (
            <button
              key={r.id}
              type="button"
              title={r.hint}
              onClick={() => {
                const { onEntry: e, exitCriteria: c } = r.build()
                setOnEntry(e)
                setExitCriteria(c)
              }}
              style={{ cursor: 'pointer' }}
              className="rounded-lg border border-border-default bg-bg px-2.5 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:border-accent/50 hover:text-text-primary"
            >
              <span className="mr-1">{r.icon}</span>
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* The sentence */}
      <div
        data-testid="automation-sentence"
        className="flex flex-wrap items-center gap-y-2 rounded-lg border border-border-default bg-bg/40 px-3 py-3 text-sm leading-7 text-text-secondary"
      >
        <span>When a task enters this column,</span>
        <Token ariaLabel="Action" value={actionType} onChange={setActionType} options={ACTION_CLAUSES} />

        {spawn && (
          <>
            <span>using</span>
            <Token
              ariaLabel="Agent"
              value={spawn.agent_id ?? BARE_CLI}
              onChange={(v) => {
                setSpawn(
                  v === BARE_CLI
                    ? { agent_id: undefined, cli: spawn.cli ?? 'claude' }
                    : { agent_id: v },
                )
              }}
              options={agentOptions}
            />
            {/* The CLI token is deliberately gone once an agent is chosen: the
                agent owns its runtime, and offering a control that silently
                loses would misrepresent what actually runs. Model stays,
                because a column overriding the model is the one exception the
                Kaiten Agents spec allows. */}
            {!attachedAgent && (
              <Token
                ariaLabel="CLI"
                value={spawn.cli ?? 'claude'}
                onChange={(v) => { setSpawn({ cli: v as SpawnCliAction['cli'] }) }}
                options={CLI_TYPES}
              />
            )}
            {isScriptAgent ? (
              // A script agent has no model to pick, and showing "auto" next to
              // one implies a choice that doesn't exist.
              <span className="mx-0.5 text-text-secondary/70">as-is</span>
            ) : (
              <Token
                ariaLabel="Model"
                value={spawn.model ?? ''}
                onChange={(v) => { setSpawn({ model: v || undefined }) }}
                options={attachedAgent ? modelOptionsWithAgentDefault : SENTENCE_MODELS}
              />
            )}
          </>
        )}

        <span>·  then move it on when</span>
        <Token ariaLabel="Advance when" value={exitCriteria.type} onChange={setExitType} options={EXIT_CLAUSES} />
        <span>.</span>
      </div>

      <p className="text-xs text-text-secondary/60">
        The prompt, runtime, retries and more live under Advanced. Most columns never need them.
      </p>
    </div>
  )
}
