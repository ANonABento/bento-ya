import { useState, useEffect } from 'react'
import { useSettingsStore } from '@/stores/settings-store'
import type { AgentConfig, ProviderConfig } from '@/types/settings'
import { detectSingleCli, type DetectedCli } from '@/lib/ipc'
import { SettingSection, SettingRow, SettingInput, SettingSlider } from '@/components/shared/setting-components'
import { Dropdown } from '@/components/shared/dropdown'

const PROVIDER_INFO: Record<string, { name: string; description: string; models: string[]; cliId: string }> = {
  anthropic: {
    name: 'Anthropic',
    description: 'Claude models via CLI or API',
    models: ['claude-haiku-4-5-20251115', 'claude-sonnet-4-6-20260217', 'claude-opus-4-6-20260217'],
    cliId: 'claude',
  },
  openai: {
    name: 'OpenAI',
    description: 'Codex models via CLI or API',
    models: ['codex-5.2', 'codex-5.3', 'codex-5.3-spark'],
    cliId: 'codex',
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

  // CLI detection state per provider
  const [detectedClis, setDetectedClis] = useState<Record<string, DetectedCli>>({})
  const [detecting, setDetecting] = useState<Record<string, boolean>>({})

  // Track expanded state (separate from enabled)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})

  // Persist coming-soon collapsed state (default to collapsed/hidden)
  const [comingSoonCollapsed, setComingSoonCollapsed] = useState(() => {
    try {
      const saved = localStorage.getItem('agent-tab-coming-soon-collapsed')
      return saved === null ? true : saved === 'true'
    } catch {
      return true
    }
  })

  useEffect(() => {
    localStorage.setItem('agent-tab-coming-soon-collapsed', String(comingSoonCollapsed))
  }, [comingSoonCollapsed])

  const updateAgent = (updates: Partial<AgentConfig>) => {
    updateGlobal('agent', { ...agent, ...updates })
  }

  const updateProvider = (providerId: string, updates: Partial<ProviderConfig>) => {
    const providers = model.providers.map((p) =>
      p.id === providerId ? { ...p, ...updates } : p
    )
    updateGlobal('model', { ...model, providers })
  }

  // Get all available models from enabled providers
  const availableModels = model.providers
    .filter((p) => p.enabled)
    .flatMap((p) => PROVIDER_INFO[p.id]?.models ?? [])

  // Toggle provider enabled state
  const handleToggleProvider = (providerId: string, enabled: boolean) => {
    updateProvider(providerId, { enabled })
    // Auto-expand when enabling, collapse when disabling
    setExpanded((prev) => ({ ...prev, [providerId]: enabled }))
  }

  // Toggle expanded state (only when enabled)
  const handleToggleExpanded = (providerId: string) => {
    const provider = model.providers.find((p) => p.id === providerId)
    if (!provider?.enabled) return
    setExpanded((prev) => ({ ...prev, [providerId]: !prev[providerId] }))
  }

  // Auto-detect CLI when switching to CLI mode
  const handleCliModeSelect = async (providerId: string) => {
    const cliId = PROVIDER_INFO[providerId]?.cliId
    if (!cliId) return

    // Set mode first
    updateProvider(providerId, { connectionMode: 'cli' })

    // Check if we already have a path set
    const provider = model.providers.find((p) => p.id === providerId)
    if (provider?.cliPath) return

    // Check if already detected
    if (detectedClis[cliId]?.isAvailable) {
      updateProvider(providerId, { cliPath: detectedClis[cliId].path })
      return
    }

    // Detect the CLI
    setDetecting((prev) => ({ ...prev, [providerId]: true }))
    try {
      const detected = await detectSingleCli(cliId)
      setDetectedClis((prev) => ({ ...prev, [cliId]: detected }))
      if (detected.isAvailable) {
        updateProvider(providerId, { cliPath: detected.path })
      }
    } catch (err) {
      console.error('Failed to detect CLI:', err)
    } finally {
      setDetecting((prev) => ({ ...prev, [providerId]: false }))
    }
  }

  return (
    <div className="space-y-6">
      {/* Providers */}
      <SettingSection title="Providers">
        <div className="space-y-3">
          {model.providers.map((provider) => {
            const info = PROVIDER_INFO[provider.id]
            if (!info) return null
            const isExpanded = expanded[provider.id] && provider.enabled

            return (
              <div
                key={provider.id}
                className={`rounded-lg border transition-all ${
                  provider.enabled
                    ? 'border-accent bg-accent/5'
                    : 'border-border-default hover:border-border-default/80'
                }`}
              >
                {/* Provider Header */}
                <div
                  className={`flex items-center justify-between p-3 ${
                    provider.enabled ? 'cursor-pointer' : ''
                  }`}
                  onClick={() => { handleToggleExpanded(provider.id) }}
                >
                  <div className="flex items-center gap-3">
                    {/* Chevron (only when enabled) */}
                    {provider.enabled && (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        className={`h-4 w-4 text-text-secondary transition-transform ${
                          isExpanded ? 'rotate-90' : ''
                        }`}
                      >
                        <path
                          fillRule="evenodd"
                          d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                          clipRule="evenodd"
                        />
                      </svg>
                    )}
                    <div className="text-left">
                      <span className={`text-sm font-medium ${provider.enabled ? 'text-text-primary' : 'text-text-secondary'}`}>
                        {info.name}
                      </span>
                      <p className="text-xs text-text-secondary">{info.description}</p>
                    </div>
                  </div>

                  {/* Toggle Switch */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleToggleProvider(provider.id, !provider.enabled)
                    }}
                    className={`relative h-6 w-11 rounded-full transition-colors ${
                      provider.enabled ? 'bg-accent' : 'bg-surface-hover'
                    }`}
                  >
                    <span
                      className={`absolute top-1 h-4 w-4 rounded-full bg-white shadow transition-all ${
                        provider.enabled ? 'left-6' : 'left-1'
                      }`}
                    />
                  </button>
                </div>

                {/* Provider Details (expanded) */}
                {isExpanded && (
                  <div className="border-t border-border-default p-3 space-y-4">
                    {/* Connection Mode */}
                    <div>
                      <label className="mb-2 block text-xs font-medium text-text-secondary">
                        Connection Mode
                      </label>
                      <div className="flex gap-2">
                        <button
                          onClick={() => { void handleCliModeSelect(provider.id) }}
                          disabled={detecting[provider.id]}
                          className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                            provider.connectionMode === 'cli'
                              ? 'border-accent bg-accent/10 text-text-primary'
                              : 'border-border-default text-text-secondary hover:border-accent/50'
                          } disabled:opacity-50`}
                        >
                          {detecting[provider.id] ? (
                            <span className="flex items-center justify-center gap-2">
                              <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                              </svg>
                              Detecting...
                            </span>
                          ) : (
                            'CLI'
                          )}
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
                        <label className="mb-2 flex items-center gap-2 text-xs font-medium text-text-secondary">
                          CLI Path
                          {provider.cliPath && (
                            <span className="flex items-center gap-1 text-green-500">
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                                <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
                              </svg>
                              Auto-detected
                            </span>
                          )}
                        </label>
                        <SettingInput
                          value={provider.cliPath ?? ''}
                          onChange={(value) => { updateProvider(provider.id, { cliPath: value }) }}
                          placeholder={provider.id === 'anthropic' ? 'claude' : 'codex'}
                          mono
                        />
                        {!provider.cliPath && (
                          <p className="mt-1 text-xs text-yellow-500">
                            CLI not found. Install or enter path manually.
                          </p>
                        )}
                      </div>
                    )}

                    {/* API Key (only for API mode) */}
                    {provider.connectionMode === 'api' && (
                      <div>
                        <label className="mb-2 block text-xs font-medium text-text-secondary">
                          API Key (env var: {provider.apiKeyEnvVar})
                        </label>
                        <SettingInput
                          value={agent.envVars[provider.apiKeyEnvVar] ?? ''}
                          onChange={(value) => {
                            updateAgent({
                              envVars: { ...agent.envVars, [provider.apiKeyEnvVar]: value },
                            })
                          }}
                          placeholder="sk-..."
                          type="password"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </SettingSection>

      {/* Coming Soon */}
      <SettingSection title="Coming Soon">
        <button
          onClick={() => { setComingSoonCollapsed(!comingSoonCollapsed) }}
          className="flex w-full items-center justify-between mb-2 -mt-2"
        >
          <span className="text-xs text-text-secondary">
            {comingSoonCollapsed ? 'Show upcoming providers' : 'Hide upcoming providers'}
          </span>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className={`h-4 w-4 text-text-secondary transition-transform ${
              comingSoonCollapsed ? '' : 'rotate-180'
            }`}
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </button>
        {!comingSoonCollapsed && (
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
      </SettingSection>

      {/* Orchestrator Settings */}
      <SettingSection title="Orchestrator" border>
        <div className="space-y-4">
          {/* Model Selection */}
          <SettingRow label="Model Selection" description="Auto lets the orchestrator choose the best model per task" vertical>
            <Dropdown
              options={[
                { value: 'auto', label: 'Auto', description: 'Orchestrator chooses best model per task' },
                ...availableModels.map((m) => ({ value: m, label: m })),
              ]}
              value={agent.modelSelection}
              onChange={(value) => { updateAgent({ modelSelection: value }) }}
            />
          </SettingRow>

          {/* Max Concurrent Agents */}
          <SettingRow label="Max Concurrent Agents" vertical>
            <SettingSlider
              value={agent.maxConcurrentAgents}
              onChange={(value) => { updateAgent({ maxConcurrentAgents: value }) }}
              min={1}
              max={50}
            />
          </SettingRow>

        </div>
      </SettingSection>
    </div>
  )
}
