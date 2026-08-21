import type {
  ActionType,
  TriggerAction,
} from '@/types'
import { DEFAULT_SPAWN_CLI } from '@/types/column'
import { BaseBranchActionEditor } from './base-branch-action-editor'
import { ACTION_TYPES } from './column-config-constants'
import { MoveColumnActionEditor } from './move-column-action-editor'
import { RunScriptActionEditor } from './run-script-action-editor'
import { SpawnCliActionEditor } from './spawn-cli-action-editor'

// Actions that require extra user awareness (irreversible or affects shared state)
const DANGEROUS_ACTIONS: ActionType[] = ['auto_merge', 'create_pr']

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
      {/* Action type selector — compact 3-column grid */}
      <div className="grid grid-cols-3 gap-1.5">
        {actionTypes.map((t) => {
          const isDangerous = DANGEROUS_ACTIONS.includes(t.value)
          const isSelected = action.type === t.value
          return (
            <button
              key={t.value}
              type="button"
              onClick={() => { handleTypeChange(t.value) }}
              className={`rounded-lg border px-2.5 py-2 text-left text-xs transition-colors ${
                isSelected
                  ? isDangerous
                    ? 'border-amber-500/60 bg-amber-500/10 text-text-primary'
                    : 'border-accent bg-accent/10 text-text-primary'
                  : 'border-border-default text-text-secondary hover:border-text-secondary'
              }`}
            >
              <div className="flex items-center gap-1">
                <span className="font-medium leading-tight">{t.label}</span>
                {isDangerous && (
                  <span className="text-amber-400" title="Irreversible action">⚠</span>
                )}
              </div>
              <div className="mt-0.5 text-xs opacity-60 leading-tight">{t.description}</div>
            </button>
          )
        })}
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

      {(action.type === 'create_pr' || action.type === 'auto_merge') && (
        <BaseBranchActionEditor
          action={action}
          setAction={(nextAction) => { setAction(nextAction) }}
        />
      )}

      {action.type === 'auto_merge' && (
        <div className="flex items-start gap-2 rounded-md bg-amber-500/10 border border-amber-500/30 px-3 py-2">
          <span className="mt-0.5 text-amber-400 text-xs">⚠</span>
          <p className="text-xs text-amber-300">
            Auto Merge will merge the pull request automatically. Ensure CI and any required reviews
            are complete before this trigger fires.
          </p>
        </div>
      )}
    </div>
  )
}
