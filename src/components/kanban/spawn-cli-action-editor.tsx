import type { AgentRuntimeMode, CliType, SpawnCliAction } from '@/types'
import { CLI_TYPES, COMMON_COMMANDS } from './column-config-constants'

type SpawnCliActionEditorProps = {
  action: SpawnCliAction
  setAction: (value: SpawnCliAction) => void
}

const RUNTIME_MODES: Array<{
  value: AgentRuntimeMode
  label: string
  caption: string
}> = [
  {
    value: 'terminal',
    label: 'Terminal',
    caption: 'tmux',
  },
  {
    value: 'managed',
    label: 'Managed',
    caption: 'events',
  },
]

const MODEL_OPTIONS: Array<{ value: string; label: string; description: string }> = [
  { value: '', label: 'Auto', description: 'Use CLI default' },
  { value: 'claude-opus-4-5', label: 'Opus', description: 'Most capable' },
  { value: 'claude-sonnet-4-5', label: 'Sonnet', description: 'Balanced' },
  { value: 'claude-haiku-4-5', label: 'Haiku', description: 'Fast & lean' },
]

const TEMPLATE_VARIABLES = [
  { name: '{task.title}', desc: 'Task title' },
  { name: '{task.description}', desc: 'Task description' },
  { name: '{task.trigger_prompt}', desc: 'Per-task prompt override' },
  { name: '{task.id}', desc: 'Task UUID' },
  { name: '{column.name}', desc: 'Current column name' },
  { name: '{prev_column.name}', desc: 'Previous column name' },
  { name: '{workspace.path}', desc: 'Repo path on disk' },
  { name: '{task.worktree_path}', desc: 'Git worktree path (if set)' },
  { name: '{dep.<id>.last_output}', desc: 'Output from a dependency task' },
]

export function SpawnCliActionEditor({
  action,
  setAction,
}: SpawnCliActionEditorProps) {
  const runtimeMode = action.runtime_mode ?? 'terminal'
  const isManagedMode = runtimeMode === 'managed'

  return (
    <div className="space-y-3 rounded-lg border border-border-default bg-bg/50 p-3">
      {/* CLI + Command */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">
            CLI
          </label>
          <select
            value={action.cli || 'claude'}
            onChange={(e) => { setAction({ ...action, cli: e.target.value as CliType }) }}
            className="w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
          >
            {CLI_TYPES.map((cli) => (
              <option key={cli.value} value={cli.value}>
                {cli.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">
            Command
          </label>
          <div className="relative">
            <input
              type="text"
              value={action.command || ''}
              onChange={(e) => { setAction({ ...action, command: e.target.value }) }}
              placeholder="/start-task"
              className="w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
              list="common-commands"
            />
            <datalist id="common-commands">
              {COMMON_COMMANDS.map((command) => (
                <option key={command} value={command} />
              ))}
            </datalist>
          </div>
        </div>
      </div>

      {/* Model + Runtime */}
      <div className="grid grid-cols-2 gap-3">
        {/* Model override */}
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">
            Model
          </label>
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-border-default bg-bg p-1">
            {MODEL_OPTIONS.map((opt) => {
              const selected = (action.model ?? '') === opt.value
              return (
                <button
                  key={opt.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    setAction({ ...action, model: opt.value || undefined })
                  }}
                  style={{ cursor: 'pointer' }}
                  className={`rounded-md px-2 py-1.5 text-left transition-colors ${
                    selected
                      ? 'bg-bg-elevated text-text-primary shadow-sm'
                      : 'text-text-secondary hover:bg-bg-elevated/60 hover:text-text-primary'
                  }`}
                >
                  <span className="block text-xs font-medium">{opt.label}</span>
                  <span className="block text-xs opacity-60">{opt.description}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Runtime toggle */}
        <div>
          <label className="mb-1 block text-xs font-medium text-text-secondary">
            Runtime
          </label>
          <div className="grid grid-cols-2 gap-1 rounded-lg border border-border-default bg-bg p-1">
            {RUNTIME_MODES.map((mode) => {
              const selected = runtimeMode === mode.value
              return (
                <button
                  key={mode.value}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => { setAction({ ...action, runtime_mode: mode.value }) }}
                  style={{ cursor: 'pointer' }}
                  className={`rounded-md px-2 py-1.5 text-left transition-colors ${
                    selected
                      ? 'bg-bg-elevated text-text-primary shadow-sm'
                      : 'text-text-secondary hover:bg-bg-elevated/60 hover:text-text-primary'
                  }`}
                >
                  <span className="block text-xs font-medium">{mode.label}</span>
                  <span className="block text-xs opacity-60">{mode.caption}</span>
                </button>
              )
            })}
          </div>
          {isManagedMode && (
            <p className="mt-1 text-xs text-amber-400">
              Managed mode streams structured events; Terminal is more reliable for long-running agents.
            </p>
          )}
        </div>
      </div>

      {/* Prompt Template */}
      <div>
        <label className="mb-1 block text-xs font-medium text-text-secondary">
          Prompt Template
        </label>
        <textarea
          value={action.prompt_template || ''}
          onChange={(e) => { setAction({ ...action, prompt_template: e.target.value }) }}
          placeholder="{task.title}&#10;&#10;{task.description}&#10;&#10;{task.trigger_prompt}"
          rows={4}
          className="w-full rounded-lg border border-border-default bg-bg px-3 py-2 font-mono text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
        />
        <details className="mt-1">
          <summary
            className="text-xs text-text-secondary hover:text-text-primary"
            style={{ cursor: 'pointer' }}
          >
            Available variables
          </summary>
          <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-0.5 rounded-lg border border-border-default bg-bg/60 p-2">
            {TEMPLATE_VARIABLES.map((v) => (
              <div key={v.name} className="flex items-baseline gap-1.5">
                <code className="shrink-0 text-xs font-mono text-accent">{v.name}</code>
                <span className="truncate text-xs text-text-secondary">{v.desc}</span>
              </div>
            ))}
          </div>
        </details>
      </div>

      {/* Queue checkbox */}
      <label className="flex items-center gap-2 text-sm text-text-secondary">
        <input
          type="checkbox"
          checked={action.use_queue !== false}
          onChange={(e) => { setAction({ ...action, use_queue: e.target.checked }) }}
          className="h-4 w-4 rounded border-border-default accent-accent"
        />
        Use agent queue
        <span className="ml-0.5 rounded bg-bg-elevated px-1.5 py-0.5 text-xs text-text-secondary">
          max 3 concurrent
        </span>
      </label>
    </div>
  )
}
