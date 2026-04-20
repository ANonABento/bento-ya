import type { MoveColumnAction } from '@/types'

type MoveColumnActionEditorProps = {
  action: MoveColumnAction
  setAction: (value: MoveColumnAction) => void
}

export function MoveColumnActionEditor({
  action,
  setAction,
}: MoveColumnActionEditorProps) {
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
