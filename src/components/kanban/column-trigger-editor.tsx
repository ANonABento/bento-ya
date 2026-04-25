import type { ExitCriteria, TriggerAction } from '@/types'
import { AdvancedTriggerEditor } from './column-trigger-advanced-editor'
import { TriggerPromptInput } from './column-trigger-prompt-input'
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
      <TriggerPromptInput
        prompt={prompt}
        generating={generating}
        genError={genError}
        onPromptChange={setPrompt}
        onGenerate={() => { void generate() }}
      />

      <div className="border-t border-border-default" />

      <button
        type="button"
        onClick={() => { setShowAdvanced(!showAdvanced) }}
        className="flex items-center gap-1.5 text-xs font-medium text-text-secondary hover:text-text-primary"
      >
        <span className={`transition-transform ${showAdvanced ? 'rotate-90' : ''}`}>▶</span>
        {showAdvanced ? 'Hide' : 'Show'} advanced editor
      </button>

      {showAdvanced && (
        <AdvancedTriggerEditor
          onEntry={onEntry}
          setOnEntry={setOnEntry}
          onExit={onExit}
          setOnExit={setOnExit}
        />
      )}
    </div>
  )
}
