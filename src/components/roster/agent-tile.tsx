import type { Agent } from '@/types'
import { parseAgentAvatar } from '@/types'

/**
 * Character-select tile for one agent.
 *
 * The gradient portrait is the roster's one deliberate flourish — everything
 * else here uses the app's ordinary surface/border/text tokens so a grid of
 * agents reads as part of the same product as the board.
 *
 * The runtime is stated in words rather than colour-coded: the portrait already
 * distinguishes agents at a glance, the toolbar already filters by runtime, and
 * a per-runtime hue would mean inventing palette entries the design system
 * doesn't have.
 */
export function AgentTile({
  agent,
  selected,
  onSelect,
}: {
  agent: Agent
  selected: boolean
  onSelect: () => void
}) {
  const avatar = parseAgentAvatar(agent.avatar, agent.name)

  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      data-testid={`agent-tile-${agent.id}`}
      style={{ cursor: 'pointer' }}
      className={`group relative overflow-hidden rounded-lg border bg-surface text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg ${
        selected
          ? 'border-accent'
          : 'border-border-default hover:border-text-secondary'
      }`}
    >
      <div
        className="relative flex h-20 items-center justify-center"
        style={{
          background: `linear-gradient(140deg, ${avatar.gradientFrom}, ${avatar.gradientTo})`,
        }}
      >
        <span className="font-mono text-2xl font-bold tracking-tight text-white/90">
          {avatar.initials}
        </span>
        {selected && (
          <span className="absolute left-2 top-2 rounded bg-accent px-1.5 py-0.5 text-xs font-medium text-bg">
            Selected
          </span>
        )}
      </div>
      <div className="px-3 py-2">
        <div className="truncate text-sm font-medium text-text-primary">{agent.name}</div>
        <div className="mt-1 font-mono text-xs uppercase tracking-wider text-text-secondary">
          {agent.runtime}
        </div>
      </div>
    </button>
  )
}

export function NewAgentTile({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid="agent-tile-new"
      style={{ cursor: 'pointer' }}
      className="flex min-h-[118px] flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border-default text-text-secondary transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-1 focus-visible:ring-offset-bg"
    >
      <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" aria-hidden="true">
        <path d="M10.75 4.75a.75.75 0 0 0-1.5 0v4.5h-4.5a.75.75 0 0 0 0 1.5h4.5v4.5a.75.75 0 0 0 1.5 0v-4.5h4.5a.75.75 0 0 0 0-1.5h-4.5v-4.5Z" />
      </svg>
      <span className="text-xs font-medium">New agent</span>
    </button>
  )
}
