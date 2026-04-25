import type { TriggerAction } from '@/types'
import { ActionEditor } from './column-trigger-action-editors'

type AdvancedTriggerEditorProps = {
  onEntry: TriggerAction
  setOnEntry: (value: TriggerAction) => void
  onExit: TriggerAction
  setOnExit: (value: TriggerAction) => void
}

export function AdvancedTriggerEditor({
  onEntry,
  setOnEntry,
  onExit,
  setOnExit,
}: AdvancedTriggerEditorProps) {
  return (
    <>
      <div>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary">
          <span className="flex h-5 w-5 items-center justify-center rounded bg-success/20 text-xs text-success">→</span>
          On Entry
        </h3>
        <p className="mb-3 text-xs text-text-secondary">
          Fires when a task enters this column (created, moved, or auto-advanced)
        </p>
        <ActionEditor action={onEntry} setAction={setOnEntry} />
      </div>

      <div className="border-t border-border-default" />

      <div>
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary">
          <span className="flex h-5 w-5 items-center justify-center rounded bg-error/20 text-xs text-error">←</span>
          On Exit
        </h3>
        <p className="mb-3 text-xs text-text-secondary">
          Fires when exit criteria are met (before task leaves column)
        </p>
        <ActionEditor action={onExit} setAction={setOnExit} showMoveColumn />
      </div>
    </>
  )
}
