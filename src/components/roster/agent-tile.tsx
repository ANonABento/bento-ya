import type { Agent } from '@/types'
import { parseAgentAvatar } from '@/types'

/**
 * Character-select tile for one agent. The portrait is initials over the
 * agent's stored gradient, with a faint scanline overlay — the "roster" feel
 * comes from here, so keep it distinct from a plain list row.
 */

const RUNTIME_TONE: Record<Agent['runtime'], string> = {
  claude: 'text-[#56c2d6]',
  codex: 'text-[#56c2d6]',
  script: 'text-[#b58cff]',
}

const RUNTIME_DOT: Record<Agent['runtime'], string> = {
  claude: 'bg-[#56c2d6]',
  codex: 'bg-[#56c2d6]',
  script: 'bg-[#b58cff]',
}

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
      className={`group relative overflow-hidden rounded-lg border text-left transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
        selected
          ? 'border-accent shadow-[0_0_0_1px_var(--accent)]'
          : 'border-border-default hover:-translate-y-0.5 hover:border-text-secondary'
      }`}
    >
      <div
        className="relative flex h-20 items-center justify-center"
        style={{
          background: `linear-gradient(140deg, ${avatar.gradientFrom}, ${avatar.gradientTo})`,
        }}
      >
        <span className="font-mono text-2xl font-extrabold tracking-tight text-white/90">
          {avatar.initials}
        </span>
        {/* Scanlines — decorative only. */}
        <span
          aria-hidden="true"
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage: 'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px)',
            backgroundSize: '100% 7px',
          }}
        />
        {selected && (
          <span className="absolute left-2 top-2 rounded bg-accent px-1.5 py-0.5 font-mono text-[9px] font-bold tracking-wider text-bg">
            SELECTED
          </span>
        )}
      </div>
      <div className="bg-surface px-2.5 py-2">
        <div className="truncate text-[13px] font-semibold text-text-primary">{agent.name}</div>
        <div
          className={`mt-1 flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-wider ${RUNTIME_TONE[agent.runtime]}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${RUNTIME_DOT[agent.runtime]}`} />
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
      className="flex min-h-[118px] flex-col items-center justify-center rounded-lg border border-dashed border-border-default text-text-secondary transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <span className="text-2xl leading-none text-accent">+</span>
      <span className="mt-1 font-mono text-[10px] uppercase tracking-wider">New agent</span>
    </button>
  )
}
