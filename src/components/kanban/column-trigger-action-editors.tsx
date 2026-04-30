import type {
  ActionType,
  TriggerAction,
} from '@/types'
import { DEFAULT_SPAWN_CLI } from '@/types/column'
import { ACTION_TYPES } from './column-config-constants'
import { CreatePrActionEditor } from './create-pr-action-editor'
import { MoveColumnActionEditor } from './move-column-action-editor'
import { RunScriptActionEditor } from './run-script-action-editor'
import { SpawnCliActionEditor } from './spawn-cli-action-editor'

type ActionEditorProps = {
  action: TriggerAction
  setAction: (value: TriggerAction) => void
  showMoveColumn?: boolean
}

export function ActionEditor({
  action,
  setAction,
  showMoveColumn = false,
}: ActionEditorProps) {
  const actionTypes = showMoveColumn ? ACTION_TYPES : ACTION_TYPES.filter((t) => t.value !== 'move_column')

  const handleTypeChange = (type: ActionType) => {
    if (type === 'none') {
      setAction({ type: 'none' })
    } else if (type === 'auto_setup') {
      setAction({ type: 'auto_setup' })
    } else if (type === 'run_script') {
      setAction({ type: 'run_script', script_id: '' })
    } else if (type === 'spawn_cli') {
      setAction({ ...DEFAULT_SPAWN_CLI })
    } else if (type === 'move_column') {
      setAction({ type: 'move_column', target: 'next' })
    } else if (type === 'create_pr') {
      setAction({ type: 'create_pr', base_branch: 'main' })
    } else if (type === 'auto_merge') {
      setAction({ type: 'auto_merge', base_branch: 'main' })
    }
  }

  return (
    <div className="space-y-3">
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

      {action.type === 'run_script' && (
        <RunScriptActionEditor
          action={action}
          setAction={(nextAction) => { setAction(nextAction) }}
        />
      )}

      {action.type === 'spawn_cli' && (
        <SpawnCliActionEditor
          action={action}
          setAction={(nextAction) => { setAction(nextAction) }}
        />
      )}

      {action.type === 'move_column' && (
        <MoveColumnActionEditor
          action={action}
          setAction={(nextAction) => { setAction(nextAction) }}
        />
      )}

      {action.type === 'create_pr' && (
        <CreatePrActionEditor
          action={action}
          setAction={(nextAction) => { setAction(nextAction) }}
        />
      )}

      {action.type === 'auto_merge' && (
        <CreatePrActionEditor
          action={action}
          setAction={(nextAction) => { setAction(nextAction) }}
        />
      )}
    </div>
  )
}
