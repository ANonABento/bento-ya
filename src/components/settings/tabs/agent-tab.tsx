import { useSettingsStore } from '@/stores/settings-store'
import type { AgentConfig } from '@/types/settings'

const CLI_OPTIONS = [
  { id: 'claude', label: 'Claude Code', description: 'Anthropic Claude CLI' },
  { id: 'codex', label: 'Codex CLI', description: 'OpenAI Codex CLI' },
  { id: 'aider', label: 'Aider', description: 'AI pair programming' },
  { id: 'custom', label: 'Custom', description: 'Custom CLI path' },
] as const

export function AgentTab() {
  const global = useSettingsStore((s) => s.global)
  const updateGlobal = useSettingsStore((s) => s.updateGlobal)
  const agent = global.agent

  const updateAgent = (updates: Partial<AgentConfig>) => {
    updateGlobal('agent', { ...agent, ...updates })
  }

  return (
    <div className="space-y-8">
      <section>
        <h3 className="mb-4 text-sm font-medium text-text-primary">Default CLI</h3>
        <div className="grid gap-2">
          {CLI_OPTIONS.map((cli) => (
            <button
              key={cli.id}
              onClick={() => updateAgent({ defaultCli: cli.id })}
              className={`flex flex-col items-start rounded-lg border p-3 text-left transition-colors ${
                agent.defaultCli === cli.id
                  ? 'border-accent bg-accent/10'
                  : 'border-border-default hover:border-accent/50'
              }`}
            >
              <span className="text-sm font-medium text-text-primary">{cli.label}</span>
              <span className="text-xs text-text-secondary">{cli.description}</span>
            </button>
          ))}
        </div>
      </section>

      {agent.defaultCli === 'custom' && (
        <section>
          <h3 className="mb-4 text-sm font-medium text-text-primary">Custom CLI Path</h3>
          <input
            type="text"
            value={agent.customCliPath}
            onChange={(e) => updateAgent({ customCliPath: e.target.value })}
            placeholder="/path/to/cli"
            className="w-full rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
          />
        </section>
      )}

      <section>
        <h3 className="mb-4 text-sm font-medium text-text-primary">Max Concurrent Agents</h3>
        <div className="flex items-center gap-4">
          <input
            type="range"
            min={1}
            max={10}
            value={agent.maxConcurrentAgents}
            onChange={(e) => updateAgent({ maxConcurrentAgents: parseInt(e.target.value, 10) })}
            className="flex-1"
          />
          <span className="w-8 text-center text-sm text-text-primary">{agent.maxConcurrentAgents}</span>
        </div>
      </section>

      <section>
        <h3 className="mb-4 text-sm font-medium text-text-primary">Instructions File</h3>
        <input
          type="text"
          value={agent.instructionsFile}
          onChange={(e) => updateAgent({ instructionsFile: e.target.value })}
          placeholder="Path to CLAUDE.md or instructions file"
          className="w-full rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
        />
        <p className="mt-2 text-xs text-text-secondary">
          Custom instructions file that will be loaded for all agents
        </p>
      </section>
    </div>
  )
}
