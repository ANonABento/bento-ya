import { useState, useEffect } from 'react'
import type {
  ColumnTriggers,
  TriggerAction,
  SpawnCliAction,
  MoveColumnAction,
  RunScriptAction,
  ExitCriteria,
  Script,
  CliType,
  ActionType,
} from '@/types'
import { parseSteps } from '@/types'
import { useColumnStore } from '@/stores/column-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useSettingsStore } from '@/stores/settings-store'
import { DEFAULT_SPAWN_CLI } from '@/types/column'
import * as ipc from '@/lib/ipc'
import { ACTION_TYPES, CLI_TYPES, COMMON_COMMANDS } from './column-config-constants'

// ─── Triggers Tab ───────────────────────────────────────────────────────────

export function TriggersTab({
  columnName,
  onEntry,
  setOnEntry,
  onExit,
  setOnExit,
  setExitCriteria,
}: {
  columnName: string
  onEntry: TriggerAction
  setOnEntry: (v: TriggerAction) => void
  onExit: TriggerAction
  setOnExit: (v: TriggerAction) => void
  setExitCriteria: (v: ExitCriteria) => void
}) {
  const [prompt, setPrompt] = useState('')
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)
  const [showAdvanced, setShowAdvanced] = useState(false)

  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId)
  const settings = useSettingsStore((s) => s.global)
  const anthropicProvider = settings.model.providers.find((p) => p.id === 'anthropic')
  const refreshColumns = useColumnStore((s) => s.load)

  const handleGenerate = async () => {
    if (!prompt.trim() || generating || !activeWorkspaceId) return
    setGenerating(true)
    setGenError(null)
    try {
      // Get or create a session to route through the orchestrator
      const session = await ipc.getActiveChatSession(activeWorkspaceId)

      // Build the message for the orchestrator
      const message = `Configure triggers for column "${columnName}": ${prompt.trim()}`

      // Get connection settings
      const connectionMode = anthropicProvider?.connectionMode ?? 'cli'
      const apiKeyEnvVar = anthropicProvider?.apiKeyEnvVar || 'ANTHROPIC_API_KEY'
      const apiKey = connectionMode === 'api'
        ? (settings.agent.envVars[apiKeyEnvVar] || undefined)
        : undefined
      const cliPath = anthropicProvider?.cliPath || 'claude'

      // Send through the orchestrator (chef will use configure_triggers tool)
      await ipc.streamOrchestratorChat(
        activeWorkspaceId,
        session.id,
        message,
        connectionMode,
        apiKey,
        apiKeyEnvVar,
        'haiku', // Use fast model for trigger generation
        cliPath,
      )

      // Reload columns to pick up trigger changes saved by the chef
      await reloadTriggers(activeWorkspaceId)
      setShowAdvanced(true)
    } catch (err) {
      setGenError(err instanceof Error ? err.message : String(err))
    } finally {
      setGenerating(false)
    }
  }

  // Reload triggers from the database after the chef saves them
  const reloadTriggers = async (workspaceId: string) => {
    try {
      const columns = await ipc.getColumns(workspaceId)
      const updated = columns.find((c) => c.name === columnName)
      if (updated?.triggers) {
        const parsed = (typeof updated.triggers === 'string'
          ? JSON.parse(updated.triggers)
          : updated.triggers) as ColumnTriggers
        if (parsed.on_entry) setOnEntry(parsed.on_entry)
        if (parsed.on_exit) setOnExit(parsed.on_exit)
        if (parsed.exit_criteria) setExitCriteria(parsed.exit_criteria)
      }
      // Also refresh the column store
      void refreshColumns(workspaceId)
    } catch {
      // Non-critical — user can still see the advanced editor
    }
  }

  return (
    <div className="space-y-6">
      {/* Natural Language Input */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-text-secondary">
          Describe your automation
        </label>
        <textarea
          value={prompt}
          onChange={(e) => { setPrompt(e.target.value) }}
          placeholder={"e.g. Run claude with /start-task when tasks enter this column.\nAuto-advance to next column when the agent completes."}
          rows={3}
          className="w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
        />
        <div className="mt-2 flex items-center gap-2">
          <button
            type="button"
            disabled={!prompt.trim() || generating}
            onClick={() => { void handleGenerate() }}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-bg transition-opacity disabled:opacity-50"
          >
            {generating ? 'Generating...' : 'Generate Triggers'}
          </button>
          {genError && (
            <span className="text-xs text-error">{genError}</span>
          )}
        </div>
      </div>

      <div className="border-t border-border-default" />

      {/* Advanced Toggle */}
      <button
        type="button"
        onClick={() => { setShowAdvanced(!showAdvanced) }}
        className="flex items-center gap-1.5 text-xs font-medium text-text-secondary hover:text-text-primary"
      >
        <span className={`transition-transform ${showAdvanced ? 'rotate-90' : ''}`}>▶</span>
        {showAdvanced ? 'Hide' : 'Show'} advanced editor
      </button>

      {/* Advanced: Manual Trigger Editor */}
      {showAdvanced && (
        <>
          {/* On Entry */}
          <div>
            <h3 className="mb-3 text-sm font-semibold text-text-primary flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded bg-success/20 text-success text-xs">→</span>
              On Entry
            </h3>
            <p className="mb-3 text-xs text-text-secondary">
              Fires when a task enters this column (created, moved, or auto-advanced)
            </p>
            <ActionEditor action={onEntry} setAction={setOnEntry} />
          </div>

          <div className="border-t border-border-default" />

          {/* On Exit */}
          <div>
            <h3 className="mb-3 text-sm font-semibold text-text-primary flex items-center gap-2">
              <span className="flex h-5 w-5 items-center justify-center rounded bg-error/20 text-error text-xs">←</span>
              On Exit
            </h3>
            <p className="mb-3 text-xs text-text-secondary">
              Fires when exit criteria are met (before task leaves column)
            </p>
            <ActionEditor action={onExit} setAction={setOnExit} showMoveColumn />
          </div>
        </>
      )}
    </div>
  )
}

// ─── Action Editor ──────────────────────────────────────────────────────────

function ActionEditor({
  action,
  setAction,
  showMoveColumn = false,
}: {
  action: TriggerAction
  setAction: (v: TriggerAction) => void
  showMoveColumn?: boolean
}) {
  const actionTypes = showMoveColumn ? ACTION_TYPES : ACTION_TYPES.filter((t) => t.value !== 'move_column')

  const handleTypeChange = (type: ActionType) => {
    if (type === 'none') {
      setAction({ type: 'none' })
    } else if (type === 'run_script') {
      setAction({ type: 'run_script', script_id: '' })
    } else if (type === 'spawn_cli') {
      setAction({ ...DEFAULT_SPAWN_CLI })
    } else if (type === 'move_column') {
      setAction({ type: 'move_column', target: 'next' })
    }
  }

  return (
    <div className="space-y-3">
      {/* Action Type Selector */}
      <div className="flex gap-2">
        {actionTypes.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => { handleTypeChange(t.value) }}
            className={`flex-1 rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
              action.type === t.value
                ? 'border-accent bg-accent/10 text-text-primary'
                : 'border-border-default text-text-secondary hover:border-text-secondary'
            }`}
          >
            <div className="font-medium">{t.label}</div>
            <div className="text-xs opacity-70">{t.description}</div>
          </button>
        ))}
      </div>

      {/* Run Script Options */}
      {action.type === 'run_script' && (
        <RunScriptEditor
          action={action}
          setAction={(a) => { setAction(a) }}
        />
      )}

      {/* Spawn CLI Options */}
      {action.type === 'spawn_cli' && (
        <SpawnCliEditor
          action={action}
          setAction={(a) => { setAction(a) }}
        />
      )}

      {/* Move Column Options */}
      {action.type === 'move_column' && (
        <MoveColumnEditor
          action={action}
          setAction={(a) => { setAction(a) }}
        />
      )}
    </div>
  )
}

// ─── Run Script Editor ──────────────────────────────────────────────────────

function RunScriptEditor({
  action,
  setAction,
}: {
  action: RunScriptAction
  setAction: (v: RunScriptAction) => void
}) {
  const [scripts, setScripts] = useState<Script[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void ipc.listScripts().then((s) => {
      setScripts(s)
      setLoading(false)
      // Auto-select first script if none selected
      if (!action.script_id && s.length > 0) {
        setAction({ ...action, script_id: s[0]!.id })
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedScript = scripts.find((s) => s.id === action.script_id)
  const steps = selectedScript ? parseSteps(selectedScript.steps) : []

  if (loading) {
    return (
      <div className="rounded-lg border border-border-default bg-bg/50 p-3 text-sm text-text-secondary">
        Loading scripts...
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-lg border border-border-default bg-bg/50 p-3">
      <div>
        <label className="mb-1 block text-xs font-medium text-text-secondary">
          Script
        </label>
        <select
          value={action.script_id}
          onChange={(e) => { setAction({ ...action, script_id: e.target.value }) }}
          className="w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
        >
          <option value="">Select a script...</option>
          {scripts.filter((s) => s.isBuiltIn).length > 0 && (
            <optgroup label="Built-in">
              {scripts.filter((s) => s.isBuiltIn).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </optgroup>
          )}
          {scripts.filter((s) => !s.isBuiltIn).length > 0 && (
            <optgroup label="Custom">
              {scripts.filter((s) => !s.isBuiltIn).map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </optgroup>
          )}
        </select>
      </div>

      {/* Script preview */}
      {selectedScript && (
        <div>
          <p className="mb-2 text-xs text-text-secondary">{selectedScript.description}</p>
          <div className="space-y-1">
            {steps.map((step, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className={`rounded px-1.5 py-0.5 font-mono ${
                  step.type === 'bash' ? 'bg-blue-500/10 text-blue-400' :
                  step.type === 'agent' ? 'bg-purple-500/10 text-purple-400' :
                  'bg-amber-500/10 text-amber-400'
                }`}>
                  {step.type}
                </span>
                <span className="text-text-secondary">{step.name || (step.type === 'agent' ? 'Agent' : step.command)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Spawn CLI Editor ───────────────────────────────────────────────────────

function SpawnCliEditor({
  action,
  setAction,
}: {
  action: SpawnCliAction
  setAction: (v: SpawnCliAction) => void
}) {
  return (
    <div className="space-y-3 rounded-lg border border-border-default bg-bg/50 p-3">
      {/* CLI Type */}
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
            {CLI_TYPES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
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
              {COMMON_COMMANDS.map((cmd) => (
                <option key={cmd} value={cmd} />
              ))}
            </datalist>
          </div>
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
          className="w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none font-mono"
        />
        <p className="mt-1 text-xs text-text-secondary">
          Variables: {'{task.title}'}, {'{task.description}'}, {'{task.trigger_prompt}'}, {'{column.name}'}, {'{workspace.path}'}
        </p>
      </div>

      {/* Use Queue Toggle */}
      <label className="flex items-center gap-2 text-sm text-text-secondary">
        <input
          type="checkbox"
          checked={action.use_queue !== false}
          onChange={(e) => { setAction({ ...action, use_queue: e.target.checked }) }}
          className="h-4 w-4 rounded border-border-default accent-accent"
        />
        Use agent queue (max 5 concurrent)
      </label>
    </div>
  )
}

// ─── Move Column Editor ─────────────────────────────────────────────────────

function MoveColumnEditor({
  action,
  setAction,
}: {
  action: MoveColumnAction
  setAction: (v: MoveColumnAction) => void
}) {
  return (
    <div className="rounded-lg border border-border-default bg-bg/50 p-3">
      <label className="mb-1 block text-xs font-medium text-text-secondary">
        Target Column
      </label>
      <select
        value={action.target}
        onChange={(e) => { setAction({ ...action, target: e.target.value as 'next' | 'previous' }) }}
        className="w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
      >
        <option value="next">Next Column</option>
        <option value="previous">Previous Column</option>
      </select>
    </div>
  )
}
