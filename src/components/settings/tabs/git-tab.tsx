import { useSettingsStore } from '@/stores/settings-store'
import type { GitConfig } from '@/types/settings'
import { SettingSection, SettingRow, SettingCard, SettingInput, SettingTextarea } from '@/components/shared/setting-components'
import { Toggle } from '@/components/shared/toggle'

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
    <div className="space-y-6">
      <SettingSection title="Branch Prefix" description="Prefix for auto-generated branch names (e.g., feat/, fix/, task/)">
        <SettingInput
          value={git.branchPrefix}
          onChange={(value) => updateGit({ branchPrefix: value })}
          placeholder="feat/"
          mono
        />
      </SettingSection>

      <SettingSection title="Base Branch" description="Default branch to create feature branches from">
        <SettingInput
          value={git.baseBranch}
          onChange={(value) => updateGit({ baseBranch: value })}
          placeholder="main"
          mono
        />
      </SettingSection>

      <SettingSection title="Merge Strategy">
        <div className="space-y-2">
          {MERGE_STRATEGIES.map((strategy) => (
            <SettingCard
              key={strategy.id}
              active={git.mergeStrategy === strategy.id}
              onClick={() => updateGit({ mergeStrategy: strategy.id })}
            >
              <span className="text-sm font-medium text-text-primary">{strategy.label}</span>
              <span className="text-xs text-text-secondary">{strategy.description}</span>
            </SettingCard>
          ))}
        </div>
      </SettingSection>

      <SettingSection title="Automation">
        <SettingRow
          label="Auto-create PR"
          description="Automatically create PR when task reaches Review column"
        >
          <Toggle
            checked={git.autoPr}
            onChange={(checked) => updateGit({ autoPr: checked })}
          />
        </SettingRow>
      </SettingSection>

      <SettingSection title="PR Template" description="Default template for pull request descriptions">
        <SettingTextarea
          value={git.prTemplate}
          onChange={(value) => updateGit({ prTemplate: value })}
          placeholder="## Summary&#10;&#10;## Changes&#10;&#10;## Testing"
          rows={6}
        />
      </SettingSection>
    </div>
  )
}
