import type { ExitCriteria, TriggerAction } from '@/types'
import { ActionEditor } from './column-trigger-action-editors'
import { useColumnTriggerGeneration } from './use-column-trigger-generation'

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
  const {
    prompt,
    generating,
    genError,
    showAdvanced,
    setPrompt,
    setShowAdvanced,
    generate,
  } = useColumnTriggerGeneration({
    columnName,
    setOnEntry,
    setOnExit,
    setExitCriteria,
  })

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
            onClick={() => { void generate() }}
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
