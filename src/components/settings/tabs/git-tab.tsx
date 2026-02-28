import { useSettingsStore } from '@/stores/settings-store'
import type { GitConfig } from '@/types/settings'

const MERGE_STRATEGIES = [
  { id: 'merge', label: 'Merge', description: 'Create a merge commit' },
  { id: 'squash', label: 'Squash', description: 'Squash all commits into one' },
  { id: 'rebase', label: 'Rebase', description: 'Rebase onto target branch' },
] as const

export function GitTab() {
  const global = useSettingsStore((s) => s.global)
  const updateGlobal = useSettingsStore((s) => s.updateGlobal)
  const git = global.git

  const updateGit = (updates: Partial<GitConfig>) => {
    updateGlobal('git', { ...git, ...updates })
  }

  return (
    <div className="space-y-8">
      <section>
        <h3 className="mb-4 text-sm font-medium text-text-primary">Branch Prefix</h3>
        <input
          type="text"
          value={git.branchPrefix}
          onChange={(e) => updateGit({ branchPrefix: e.target.value })}
          placeholder="feat/"
          className="w-full rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
        />
        <p className="mt-2 text-xs text-text-secondary">
          Prefix for auto-generated branch names (e.g., feat/, fix/, task/)
        </p>
      </section>

      <section>
        <h3 className="mb-4 text-sm font-medium text-text-primary">Base Branch</h3>
        <input
          type="text"
          value={git.baseBranch}
          onChange={(e) => updateGit({ baseBranch: e.target.value })}
          placeholder="main"
          className="w-full rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
        />
        <p className="mt-2 text-xs text-text-secondary">
          Default branch to create feature branches from
        </p>
      </section>

      <section>
        <h3 className="mb-4 text-sm font-medium text-text-primary">Merge Strategy</h3>
        <div className="grid gap-2">
          {MERGE_STRATEGIES.map((strategy) => (
            <button
              key={strategy.id}
              onClick={() => updateGit({ mergeStrategy: strategy.id })}
              className={`flex flex-col items-start rounded-lg border p-3 text-left transition-colors ${
                git.mergeStrategy === strategy.id
                  ? 'border-accent bg-accent/10'
                  : 'border-border-default hover:border-accent/50'
              }`}
            >
              <span className="text-sm font-medium text-text-primary">{strategy.label}</span>
              <span className="text-xs text-text-secondary">{strategy.description}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-4 text-sm font-medium text-text-primary">Auto-Create PR</h3>
        <label className="flex cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={git.autoPr}
            onChange={(e) => updateGit({ autoPr: e.target.checked })}
            className="h-4 w-4 rounded border-border-default text-accent focus:ring-accent"
          />
          <span className="text-sm text-text-secondary">
            Automatically create PR when task reaches Review column
          </span>
        </label>
      </section>

      <section>
        <h3 className="mb-4 text-sm font-medium text-text-primary">PR Template</h3>
        <textarea
          value={git.prTemplate}
          onChange={(e) => updateGit({ prTemplate: e.target.value })}
          placeholder="## Summary\n\n## Changes\n\n## Testing"
          rows={6}
          className="w-full resize-none rounded-lg border border-border-default bg-surface px-3 py-2 font-mono text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
        />
      </section>
    </div>
  )
}
