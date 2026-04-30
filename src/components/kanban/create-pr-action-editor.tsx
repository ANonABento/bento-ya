import type { AutoMergeAction, CreatePrAction } from '@/types'

type CreatePrActionEditorProps = {
  action: CreatePrAction | AutoMergeAction
  setAction: (value: CreatePrAction | AutoMergeAction) => void
}

export function CreatePrActionEditor({
  action,
  setAction,
}: CreatePrActionEditorProps) {
  return (
    <div className="rounded-lg border border-border-default bg-bg/50 p-3">
      <label className="mb-1 block text-xs font-medium text-text-secondary">
        Base Branch
      </label>
      <input
        type="text"
        value={action.base_branch || 'main'}
        onChange={(e) => { setAction({ ...action, base_branch: e.target.value }) }}
        placeholder="main"
        className="w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
      />
      <p className="mt-1.5 text-xs text-text-secondary">
        Task PRs target staging/&lt;batch_id&gt;. This branch is the final merge target.
      </p>
    </div>
  )
}
