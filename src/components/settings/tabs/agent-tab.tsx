import { useState, useEffect } from 'react'
import { useSettingsStore } from '@/stores/settings-store'
import type { AgentConfig, ProviderConfig } from '@/types/settings'

const PROVIDER_INFO: Record<string, { name: string; description: string; models: string[] }> = {
  anthropic: {
    name: 'Anthropic',
    description: 'Claude models via CLI or API',
    models: ['claude-haiku-4-5-20251115', 'claude-sonnet-4-6-20260217', 'claude-opus-4-6-20260217'],
  },
  openai: {
    name: 'OpenAI',
    description: 'Codex models via CLI or API',
    models: ['codex-5.2', 'codex-5.3', 'codex-5.3-spark'],
  },
}

const COMING_SOON = [
  { name: 'OpenRouter', description: 'Multiple providers via single API' },
  { name: 'Google AI', description: 'Gemini models' },
  { name: 'Local Models', description: 'Ollama, LM Studio, etc.' },
]

export function AgentTab() {
  const global = useSettingsStore((s) => s.global)
  const updateGlobal = useSettingsStore((s) => s.updateGlobal)
  const agent = global.agent
  const model = global.model

  // Persist collapsed state in localStorage
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem('agent-tab-collapsed')
      return saved ? (JSON.parse(saved) as Record<string, boolean>) : {}
    } catch {
      return {}
    }
  })

  useEffect(() => {
    localStorage.setItem('agent-tab-collapsed', JSON.stringify(collapsed))
  }, [collapsed])

  const updateAgent = (updates: Partial<AgentConfig>) => {
    updateGlobal('agent', { ...agent, ...updates })
  }

  const updateProvider = (providerId: string, updates: Partial<ProviderConfig>) => {
    const providers = model.providers.map((p) =>
      p.id === providerId ? { ...p, ...updates } : p
    )
    updateGlobal('model', { ...model, providers })
  }

  const toggleCollapsed = (key: string) => {
    setCollapsed((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  // Get all available models from enabled providers
  const availableModels = model.providers
    .filter((p) => p.enabled)
    .flatMap((p) => PROVIDER_INFO[p.id]?.models ?? [])

  return (
    <div className="space-y-6">
      {/* Providers */}
      <section>
        <h3 className="mb-4 text-sm font-medium text-text-primary">Providers</h3>
        <div className="space-y-3">
          {model.providers.map((provider) => {
            const info = PROVIDER_INFO[provider.id]
            if (!info) return null

            return (
              <div
                key={provider.id}
                className={`rounded-lg border transition-colors ${
                  provider.enabled
                    ? 'border-accent bg-accent/5'
                    : 'border-border-default'
                }`}
              >
                {/* Provider Header */}
                <button
                  onClick={() => { toggleCollapsed(provider.id) }}
                  className="flex w-full items-center justify-between p-3"
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={provider.enabled}
                      onChange={(e) => {
                        e.stopPropagation()
                        updateProvider(provider.id, { enabled: e.target.checked })
                      }}
                      onClick={(e) => { e.stopPropagation() }}
                      className="h-4 w-4 rounded border-border-default accent-accent"
                    />
                    <div className="text-left">
                      <span className="text-sm font-medium text-text-primary">{info.name}</span>
                      <p className="text-xs text-text-secondary">{info.description}</p>
                    </div>
                  </div>
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    className={`h-5 w-5 text-text-secondary transition-transform ${
                      collapsed[provider.id] ? '' : 'rotate-180'
                    }`}
                  >
                    <path
                      fillRule="evenodd"
                      d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                      clipRule="evenodd"
                    />
                  </svg>
                </button>

                {/* Provider Details */}
                {!collapsed[provider.id] && provider.enabled && (
                  <div className="border-t border-border-default p-3 space-y-4">
                    {/* Connection Mode */}
                    <div>
                      <label className="mb-2 block text-xs font-medium text-text-secondary">
                        Connection Mode
                      </label>
                      <div className="flex gap-2">
                        <button
                          onClick={() => { updateProvider(provider.id, { connectionMode: 'cli' }) }}
                          className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                            provider.connectionMode === 'cli'
                              ? 'border-accent bg-accent/10 text-text-primary'
                              : 'border-border-default text-text-secondary hover:border-accent/50'
                          }`}
                        >
                          CLI
                        </button>
                        <button
                          onClick={() => { updateProvider(provider.id, { connectionMode: 'api' }) }}
                          className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                            provider.connectionMode === 'api'
                              ? 'border-accent bg-accent/10 text-text-primary'
                              : 'border-border-default text-text-secondary hover:border-accent/50'
                          }`}
                        >
                          API
                        </button>
                      </div>
                    </div>

                    {/* CLI Path (only for CLI mode) */}
                    {provider.connectionMode === 'cli' && (
                      <div>
                        <label className="mb-2 block text-xs font-medium text-text-secondary">
                          CLI Path
                        </label>
                        <input
                          type="text"
                          value={provider.cliPath ?? ''}
                          onChange={(e) => { updateProvider(provider.id, { cliPath: e.target.value }) }}
                          placeholder={provider.id === 'anthropic' ? 'claude' : 'codex'}
                          className="w-full rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
                        />
                        <p className="mt-1 text-xs text-text-secondary">
                          Leave empty to use default: {provider.id === 'anthropic' ? 'claude' : 'codex'}
                        </p>
                      </div>
                    )}

                    {/* API Key (only for API mode) */}
                    {provider.connectionMode === 'api' && (
                      <div>
                        <label className="mb-2 block text-xs font-medium text-text-secondary">
                          API Key (env var: {provider.apiKeyEnvVar})
                        </label>
                        <input
                          type="password"
                          value={agent.envVars[provider.apiKeyEnvVar] ?? ''}
                          onChange={(e) => {
                            updateAgent({
                              envVars: { ...agent.envVars, [provider.apiKeyEnvVar]: e.target.value },
                            })
                          }}
                          placeholder="sk-..."
                          className="w-full rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
                        />
                      </div>
                    )}

                    {/* Default Model */}
                    <div>
                      <label className="mb-2 block text-xs font-medium text-text-secondary">
                        Default Model
                      </label>
                      <select
                        value={provider.defaultModel}
                        onChange={(e) => { updateProvider(provider.id, { defaultModel: e.target.value }) }}
                        className="w-full rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
                      >
                        {info.models.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* Coming Soon */}
      <section>
        <button
          onClick={() => { toggleCollapsed('coming-soon') }}
          className="flex w-full items-center justify-between mb-2"
        >
          <h3 className="text-sm font-medium text-text-secondary">Coming Soon</h3>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className={`h-4 w-4 text-text-secondary transition-transform ${
              collapsed['coming-soon'] ? '' : 'rotate-180'
            }`}
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </button>
        {!collapsed['coming-soon'] && (
          <div className="space-y-2">
            {COMING_SOON.map((item) => (
              <div
                key={item.name}
                className="rounded-lg border border-border-default p-3 opacity-50"
              >
                <span className="text-sm font-medium text-text-secondary">{item.name}</span>
                <p className="text-xs text-text-secondary">{item.description}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Orchestrator Settings */}
      <section className="border-t border-border-default pt-6">
        <h3 className="mb-4 text-sm font-medium text-text-primary">Orchestrator</h3>

        {/* Model Selection */}
        <div className="mb-4">
          <label className="mb-2 block text-xs font-medium text-text-secondary">
            Model Selection
          </label>
          <select
            value={agent.modelSelection}
            onChange={(e) => { updateAgent({ modelSelection: e.target.value }) }}
            className="w-full rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none"
          >
            <option value="auto">Auto (orchestrator decides)</option>
            {availableModels.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>
          <p className="mt-1 text-xs text-text-secondary">
            Auto lets the orchestrator choose the best model per task
          </p>
        </div>

        {/* Max Concurrent Agents */}
        <div className="mb-4">
          <label className="mb-2 block text-xs font-medium text-text-secondary">
            Max Concurrent Agents
          </label>
          <div className="flex items-center gap-4">
            <input
              type="range"
              min={1}
              max={50}
              value={agent.maxConcurrentAgents}
              onChange={(e) => { updateAgent({ maxConcurrentAgents: parseInt(e.target.value, 10) }) }}
              className="flex-1"
            />
            <span className="w-8 text-center text-sm text-text-primary">
              {agent.maxConcurrentAgents}
            </span>
          </div>
        </div>

        {/* Instructions File */}
        <div>
          <label className="mb-2 block text-xs font-medium text-text-secondary">
            Instructions File
          </label>
          <input
            type="text"
            value={agent.instructionsFile}
            onChange={(e) => { updateAgent({ instructionsFile: e.target.value }) }}
            placeholder="Path to CLAUDE.md or instructions file"
            className="w-full rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
          />
          <p className="mt-1 text-xs text-text-secondary">
            Custom instructions file loaded for all agents
          </p>
        </div>
      </section>
    </div>
  )
}
