import { useSettingsStore } from '@/stores/settings-store'
import type { CardDisplayConfig } from '@/types/settings'

type ToggleProps = {
  label: string
  description?: string
  checked: boolean
  onChange: (checked: boolean) => void
}

function Toggle({ label, description, checked, onChange }: ToggleProps) {
  return (
    <label className="flex items-start justify-between gap-4 py-2">
      <div>
        <span className="text-sm text-text-primary">{label}</span>
        {description && (
          <p className="text-xs text-text-secondary">{description}</p>
        )}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
          checked ? 'bg-accent' : 'bg-surface-hover'
        }`}
      >
        <span
          className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
            checked ? 'translate-x-5' : 'translate-x-0'
          }`}
        />
      </button>
    </label>
  )
}

type NumberInputProps = {
  label: string
  description?: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  unit?: string
}

function NumberInput({ label, description, value, onChange, min = 0, max = 9999, step = 1, unit }: NumberInputProps) {
  return (
    <div className="py-2">
      <label className="flex items-center justify-between gap-4">
        <div>
          <span className="text-sm text-text-primary">{label}</span>
          {description && (
            <p className="text-xs text-text-secondary">{description}</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            min={min}
            max={max}
            step={step}
            className="w-20 rounded border border-border-default bg-surface px-2 py-1 text-sm text-text-primary text-right"
          />
          {unit && <span className="text-xs text-text-secondary">{unit}</span>}
        </div>
      </label>
    </div>
  )
}

export function CardsTab() {
  const global = useSettingsStore((s) => s.global)
  const updateGlobal = useSettingsStore((s) => s.updateGlobal)

  const cards = global.cards

  const updateCards = (updates: Partial<CardDisplayConfig>) => {
    updateGlobal('cards', { ...cards, ...updates })
  }

  return (
    <div className="space-y-8">
      {/* Card Content */}
      <section>
        <h3 className="mb-1 text-sm font-medium text-text-primary">Card Content</h3>
        <p className="mb-4 text-xs text-text-secondary">Choose what information to display on task cards</p>

        <div className="divide-y divide-border-default/50">
          <Toggle
            label="Description"
            description="Show task description preview (2 lines)"
            checked={cards.showDescription}
            onChange={(v) => updateCards({ showDescription: v })}
          />
          <Toggle
            label="Branch name"
            description="Show git branch associated with task"
            checked={cards.showBranch}
            onChange={(v) => updateCards({ showBranch: v })}
          />
          <Toggle
            label="Agent type"
            description="Show which agent is assigned (claude, codex, etc.)"
            checked={cards.showAgentType}
            onChange={(v) => updateCards({ showAgentType: v })}
          />
          <Toggle
            label="Timestamp"
            description="Show relative time since last update"
            checked={cards.showTimestamp}
            onChange={(v) => updateCards({ showTimestamp: v })}
          />
        </div>
      </section>

      {/* PR Information */}
      <section>
        <h3 className="mb-1 text-sm font-medium text-text-primary">Pull Request Info</h3>
        <p className="mb-4 text-xs text-text-secondary">Configure PR status display on cards</p>

        <div className="divide-y divide-border-default/50">
          <Toggle
            label="PR badge"
            description="Show PR number with link to GitHub"
            checked={cards.showPrBadge}
            onChange={(v) => updateCards({ showPrBadge: v })}
          />
          <Toggle
            label="CI status"
            description="Show build/test status icon"
            checked={cards.showCiStatus}
            onChange={(v) => updateCards({ showCiStatus: v })}
          />
          <Toggle
            label="Review status"
            description="Show approval/changes requested indicator"
            checked={cards.showReviewStatus}
            onChange={(v) => updateCards({ showReviewStatus: v })}
          />
          <Toggle
            label="Merge status"
            description="Show merge conflict warning"
            checked={cards.showMergeStatus}
            onChange={(v) => updateCards({ showMergeStatus: v })}
          />
          <Toggle
            label="Comment count"
            description="Show number of PR comments"
            checked={cards.showCommentCount}
            onChange={(v) => updateCards({ showCommentCount: v })}
          />
          <Toggle
            label="Labels"
            description="Show GitHub labels on cards"
            checked={cards.showLabels}
            onChange={(v) => updateCards({ showLabels: v })}
          />
        </div>
      </section>

      {/* PR Polling */}
      <section>
        <h3 className="mb-1 text-sm font-medium text-text-primary">GitHub Polling</h3>
        <p className="mb-4 text-xs text-text-secondary">Configure how often PR status is refreshed from GitHub</p>

        <div className="space-y-1">
          <Toggle
            label="Enable polling"
            description="Automatically fetch PR status updates"
            checked={cards.prPollingEnabled}
            onChange={(v) => updateCards({ prPollingEnabled: v })}
          />

          {cards.prPollingEnabled && (
            <div className="mt-4 space-y-2 rounded-lg bg-surface p-4">
              <NumberInput
                label="Poll interval"
                description="How often to check for updates"
                value={cards.prPollingIntervalSeconds}
                onChange={(v) => updateCards({ prPollingIntervalSeconds: Math.max(10, v) })}
                min={10}
                max={3600}
                step={10}
                unit="seconds"
              />
              <NumberInput
                label="Cache duration"
                description="Skip refresh if data is newer than this"
                value={cards.prCacheMaxAgeSeconds}
                onChange={(v) => updateCards({ prCacheMaxAgeSeconds: Math.max(30, v) })}
                min={30}
                max={3600}
                step={30}
                unit="seconds"
              />
              <p className="mt-2 text-xs text-text-secondary">
                Lower values = more API calls. GitHub rate limits: 5000 requests/hour for authenticated users.
              </p>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
