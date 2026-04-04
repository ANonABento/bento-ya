import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import type {
  Column,
  ColumnTriggers,
  TriggerAction,
  SpawnCliAction,
  MoveColumnAction,
  ExitCriteria,
  ExitCriteriaType,
  CliType,
  ActionType,
} from '@/types'
import { useColumnStore } from '@/stores/column-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useSettingsStore } from '@/stores/settings-store'
import { DEFAULT_SPAWN_CLI, getColumnTriggers } from '@/types/column'
import * as ipc from '@/lib/ipc'

// ─── Types ──────────────────────────────────────────────────────────────────

type ColumnConfigDialogProps = {
  column: Column
  onClose: () => void
}

type Tab = 'general' | 'triggers' | 'exit'

// ─── Constants ──────────────────────────────────────────────────────────────

const COLORS = [
  '#E8A87C', // accent
  '#4ADE80', // success
  '#60A5FA', // running/blue
  '#F59E0B', // attention/amber
  '#F87171', // error/red
  '#A78BFA', // purple
  '#EC4899', // pink
  '#6EE7B7', // teal
]

const ICONS = [
  { value: 'list', label: 'List' },
  { value: 'inbox', label: 'Inbox' },
  { value: 'play', label: 'Play' },
  { value: 'code', label: 'Code' },
  { value: 'check', label: 'Check' },
  { value: 'eye', label: 'Review' },
  { value: 'rocket', label: 'Deploy' },
  { value: 'archive', label: 'Archive' },
]

const ACTION_TYPES: { value: ActionType; label: string; description: string }[] = [
  { value: 'none', label: 'None', description: 'No action' },
  { value: 'spawn_cli', label: 'Spawn CLI', description: 'Run AI agent with command' },
  { value: 'move_column', label: 'Move Column', description: 'Move task to another column' },
]

const CLI_TYPES: { value: CliType; label: string }[] = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex' },
  { value: 'aider', label: 'Aider' },
]

const EXIT_CRITERIA_TYPES: { value: ExitCriteriaType; label: string; description: string }[] = [
  { value: 'manual', label: 'Manual', description: 'User moves task manually' },
  { value: 'agent_complete', label: 'Agent Complete', description: 'Agent finishes work' },
  { value: 'script_success', label: 'Script Success', description: 'Script exits with code 0' },
  { value: 'checklist_done', label: 'Checklist Done', description: 'All checklist items checked' },
  { value: 'time_elapsed', label: 'Time Elapsed', description: 'After timeout duration' },
  { value: 'pr_approved', label: 'PR Approved', description: 'Pull request is approved' },
  { value: 'manual_approval', label: 'Manual Approval', description: 'Reviewer approves task' },
  { value: 'notification_sent', label: 'Notification Sent', description: 'User marks as notified' },
]

const COMMON_COMMANDS = [
  '/start-task',
  '/loop-review',
  '/code-check',
  '/quality-check',
  '/fix-pr-comments',
  '/create-pr',
]

// ─── Component ──────────────────────────────────────────────────────────────

export function ColumnConfigDialog({ column, onClose }: ColumnConfigDialogProps) {
  const updateColumnAsync = useColumnStore((s) => s.updateColumnAsync)

  const [tab, setTab] = useState<Tab>('general')
  const [name, setName] = useState(column.name)
  const [icon, setIcon] = useState(column.icon || 'list')
  const [color, setColor] = useState(column.color || '#E8A87C')

  const initialTriggers = useMemo((): ColumnTriggers => {
    return getColumnTriggers(column)
  }, [column])

  const [onEntry, setOnEntry] = useState<TriggerAction>(initialTriggers.on_entry || { type: 'none' })
  const [onExit, setOnExit] = useState<TriggerAction>(initialTriggers.on_exit || { type: 'none' })
  const [exitCriteria, setExitCriteria] = useState<ExitCriteria>(
    initialTriggers.exit_criteria || { type: 'manual', auto_advance: false }
  )

  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!name.trim() || isSubmitting) return

    setIsSubmitting(true)
    try {
      const triggers: ColumnTriggers = {
        on_entry: onEntry,
        on_exit: onExit,
        exit_criteria: exitCriteria,
      }

      await updateColumnAsync(column.id, {
        name: name.trim(),
        icon,
        color,
        triggers: JSON.stringify(triggers),
      })
      onClose()
    } catch (err) {
      console.error('Failed to update column:', err)
    } finally {
      setIsSubmitting(false)
    }
  }

  // Close on escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => { window.removeEventListener('keydown', handleKeyDown) }
  }, [onClose])

  return (
    <AnimatePresence>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 10 }}
          transition={{ duration: 0.15 }}
          onClick={(e) => { e.stopPropagation() }}
          className="max-h-[90vh] w-full max-w-xl overflow-hidden rounded-xl border border-border-default bg-surface shadow-xl flex flex-col"
        >
          {/* Header */}
          <div className="border-b border-border-default px-6 py-4">
            <h2 className="text-lg font-semibold text-text-primary">
              Configure Column
            </h2>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-border-default px-6">
            {(['general', 'triggers', 'exit'] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => { setTab(t) }}
                className={`px-4 py-3 text-sm font-medium transition-colors relative ${
                  tab === t
                    ? 'text-accent'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                {t.charAt(0).toUpperCase() + t.slice(1)}
                {tab === t && (
                  <motion.div
                    layoutId="tab-indicator"
                    className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent"
                  />
                )}
              </button>
            ))}
          </div>

          {/* Content */}
          <form onSubmit={(e) => { void handleSubmit(e) }} className="flex-1 overflow-y-auto">
            <div className="p-6">
              {tab === 'general' && (
                <GeneralTab
                  name={name}
                  setName={setName}
                  icon={icon}
                  setIcon={setIcon}
                  color={color}
                  setColor={setColor}
                />
              )}
              {tab === 'triggers' && (
                <TriggersTab
                  columnName={column.name}
                  onEntry={onEntry}
                  setOnEntry={setOnEntry}
                  onExit={onExit}
                  setOnExit={setOnExit}
                  setExitCriteria={setExitCriteria}
                />
              )}
              {tab === 'exit' && (
                <ExitTab
                  exitCriteria={exitCriteria}
                  setExitCriteria={setExitCriteria}
                />
              )}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-2 border-t border-border-default px-6 py-4">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-4 py-2 text-sm text-text-secondary hover:bg-surface-hover"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={!name.trim() || isSubmitting}
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-bg disabled:opacity-50"
              >
                {isSubmitting ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        </motion.div>
      </div>
    </AnimatePresence>
  )
}

// ─── General Tab ────────────────────────────────────────────────────────────

function GeneralTab({
  name,
  setName,
  icon,
  setIcon,
  color,
  setColor,
}: {
  name: string
  setName: (v: string) => void
  icon: string
  setIcon: (v: string) => void
  color: string
  setColor: (v: string) => void
}) {
  return (
    <div className="space-y-5">
      {/* Name */}
      <div>
        <label className="mb-1.5 block text-sm font-medium text-text-secondary">
          Name
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => { setName(e.target.value) }}
          className="w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
        />
      </div>

      {/* Icon & Color */}
      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1.5 block text-sm font-medium text-text-secondary">
            Icon
          </label>
          <select
            value={icon}
            onChange={(e) => { setIcon(e.target.value) }}
            className="w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
          >
            {ICONS.map((i) => (
              <option key={i.value} value={i.value}>
                {i.label}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-1.5 block text-sm font-medium text-text-secondary">
            Color
          </label>
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => { setColor(c) }}
                className={`h-6 w-6 rounded-full transition-transform ${
                  color === c ? 'scale-110 ring-2 ring-white/50' : 'hover:scale-105'
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Triggers Tab ───────────────────────────────────────────────────────────

function TriggersTab({
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

// ─── Exit Tab ───────────────────────────────────────────────────────────────

function ExitTab({
  exitCriteria,
  setExitCriteria,
}: {
  exitCriteria: ExitCriteria
  setExitCriteria: (v: ExitCriteria) => void
}) {
  return (
    <div className="space-y-5">
      <div>
        <h3 className="mb-3 text-sm font-semibold text-text-primary">
          Exit Criteria
        </h3>
        <p className="mb-3 text-xs text-text-secondary">
          When should the on_exit trigger fire and task be allowed to advance?
        </p>

        {/* Criteria Type Grid */}
        <div className="grid grid-cols-2 gap-2">
          {EXIT_CRITERIA_TYPES.map((e) => (
            <button
              key={e.value}
              type="button"
              onClick={() => { setExitCriteria({ ...exitCriteria, type: e.value }) }}
              className={`rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                exitCriteria.type === e.value
                  ? 'border-accent bg-accent/10 text-text-primary'
                  : 'border-border-default text-text-secondary hover:border-text-secondary'
              }`}
            >
              <div className="font-medium">{e.label}</div>
              <div className="text-xs opacity-70">{e.description}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Timeout for time_elapsed */}
      {exitCriteria.type === 'time_elapsed' && (
        <div>
          <label className="mb-1.5 block text-sm font-medium text-text-secondary">
            Timeout (seconds)
          </label>
          <input
            type="number"
            value={exitCriteria.timeout || 300}
            onChange={(e) => {
              setExitCriteria({ ...exitCriteria, timeout: parseInt(e.target.value) || 300 })
            }}
            min={1}
            className="w-32 rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
          />
        </div>
      )}

      {/* Auto Advance Toggle */}
      <div className="flex items-center justify-between rounded-lg border border-border-default px-4 py-3">
        <div>
          <div className="text-sm font-medium text-text-primary">Auto Advance</div>
          <div className="text-xs text-text-secondary">
            Automatically execute on_exit trigger when criteria met
          </div>
        </div>
        <button
          type="button"
          onClick={() => {
            setExitCriteria({ ...exitCriteria, auto_advance: !exitCriteria.auto_advance })
          }}
          className={`relative h-6 w-11 rounded-full transition-colors ${
            exitCriteria.auto_advance ? 'bg-accent' : 'bg-surface-hover'
          }`}
        >
          <motion.div
            className="absolute top-1 h-4 w-4 rounded-full bg-white shadow"
            animate={{ left: exitCriteria.auto_advance ? 24 : 4 }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
          />
        </button>
      </div>
    </div>
  )
}
