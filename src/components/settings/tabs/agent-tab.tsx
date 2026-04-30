import { useState, useEffect, useMemo } from 'react'
import { useSettingsStore } from '@/stores/settings-store'
import type { AgentConfig, ProviderConfig } from '@/types/settings'
import { detectSingleCli, checkCliUpdate, type DetectedCli, type CliUpdateInfo } from '@/lib/ipc'
import { useModels } from '@/hooks/use-models'
import { SettingSection, SettingRow, SettingInput, SettingSlider } from '@/components/shared/setting-components'
import { Dropdown } from '@/components/shared/dropdown'

const PROVIDER_INFO: Record<string, { name: string; description: string; cliId: string }> = {
  anthropic: {
    name: 'Anthropic',
    description: 'Claude models via CLI or API',
    cliId: 'claude',
  },
  openai: {
    name: 'OpenAI',
    description: 'Codex models via CLI or API',
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

  // Dynamic model registry
  const { models: allModels, lastFetched, source: modelSource, refresh: refreshModels } = useModels()
  const [refreshing, setRefreshing] = useState(false)
  const [refreshStatus, setRefreshStatus] = useState<{ message: string; type: 'success' | 'error' } | null>(null)

  // CLI detection state per provider
  const [detectedClis, setDetectedClis] = useState<Record<string, DetectedCli>>({})
  const [detecting, setDetecting] = useState<Record<string, boolean>>({})

  // CLI update check state
  const [cliUpdates, setCliUpdates] = useState<Record<string, CliUpdateInfo>>({})
  const [checkingUpdate, setCheckingUpdate] = useState<Record<string, boolean>>({})
  const [copiedCmd, setCopiedCmd] = useState<string | null>(null)

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

  const budgetableModels = useMemo(() => {
    const unique = new Map<string, { id: string; displayName: string }>()
    for (const modelEntry of allModels) {
      unique.set(modelEntry.id, {
        id: modelEntry.id,
        displayName: modelEntry.displayName,
      })
    }
    return Array.from(unique.values())
      .sort((a, b) => a.displayName.localeCompare(b.displayName))
  }, [allModels])

  const updateBudget = (modelId: string, value: string) => {
    const nextBudgets = { ...model.dailyTokenBudgets }
    const trimmed = value.trim()
    if (trimmed === '') {
      delete nextBudgets[modelId]
      updateGlobal('model', { ...model, dailyTokenBudgets: nextBudgets })
      return
    }

    const parsed = Number.parseInt(trimmed, 10)
    if (Number.isFinite(parsed) && parsed > 0) {
      nextBudgets[modelId] = parsed
      updateGlobal('model', { ...model, dailyTokenBudgets: nextBudgets })
      return
    }

    if (trimmed === '0') {
      delete nextBudgets[modelId]
      updateGlobal('model', { ...model, dailyTokenBudgets: nextBudgets })
    }
  }

  // Get all available models from enabled providers, excluding disabled ones
  const enabledProviderIds = new Set(model.providers.filter((p) => p.enabled).map((p) => p.id))
  const disabledModelIds = new Set(model.disabledModels)
  const availableModels = allModels
    .filter((m) => enabledProviderIds.has(m.provider) && !disabledModelIds.has(m.id))
    .map((m) => m.id)

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
    const willExpand = !expanded[providerId]
    setExpanded((prev) => ({ ...prev, [providerId]: willExpand }))

    // Check for CLI updates when expanding in CLI mode (once per session)
    if (willExpand && provider.connectionMode === 'cli' && !cliUpdates[providerId] && !checkingUpdate[providerId]) {
      const cliId = PROVIDER_INFO[providerId]?.cliId
      if (cliId) {
        setCheckingUpdate((prev) => ({ ...prev, [providerId]: true }))
        void checkCliUpdate(cliId)
          .then((info) => { setCliUpdates((prev) => ({ ...prev, [providerId]: info })) })
          .catch(() => {})
          .finally(() => { setCheckingUpdate((prev) => ({ ...prev, [providerId]: false })) })
      }
    }
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
        <div className="mb-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-text-secondary">
              {allModels.length} models ·{' '}
              {modelSource === 'api'
                ? `From API${lastFetched ? ` · ${new Date(lastFetched).toLocaleDateString()}` : ''}`
                : modelSource === 'cli'
                  ? 'From CLI'
                  : 'Built-in list'}
            </span>
            <button
              onClick={() => {
                setRefreshing(true)
                setRefreshStatus(null)
                void refreshModels().then((result) => {
                  if (result.success) {
                    const msg = result.newModels.length > 0
                      ? `Found ${String(result.newModels.length)} new: ${result.newModels.join(', ')}`
                      : `${String(result.modelCount)} models up to date`
                    setRefreshStatus({ message: msg, type: 'success' })
                  } else {
                    setRefreshStatus({
                      message: result.error ?? 'Set API keys to discover new models automatically',
                      type: 'error',
                    })
                  }
                  setRefreshing(false)
                  // Auto-dismiss after 5s
                  setTimeout(() => { setRefreshStatus(null) }, 5000)
                })
              }}
              disabled={refreshing}
              className="flex items-center gap-1.5 rounded-md border border-border-default px-2 py-1 text-xs text-text-secondary transition-colors hover:border-accent hover:text-text-primary disabled:opacity-50"
            >
              {refreshing ? (
                <>
                  <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Checking...
                </>
              ) : (
                'Check for new models'
              )}
            </button>
          </div>
          {refreshStatus && (
            <div
              className={`rounded-md px-3 py-1.5 text-xs transition-all ${
                refreshStatus.type === 'success'
                  ? 'bg-green-500/10 text-green-400'
                  : 'bg-yellow-500/10 text-yellow-400'
              }`}
            >
              {refreshStatus.message}
            </div>
          )}
        </div>
        <div className="space-y-3">
          {model.providers.map((provider) => {
            const info = PROVIDER_INFO[provider.id]
            if (!info) return null
            const isExpanded = expanded[provider.id] && provider.enabled
            const providerModels = allModels.filter((m) => m.provider === provider.id)
            const providerModelCount = providerModels.length

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
                  className="flex items-center justify-between p-3"
                  style={{ cursor: provider.enabled ? 'pointer' : 'default' }}
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
                        {providerModelCount > 0 && (
                          <span className="ml-1.5 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-accent/20 px-1 text-[10px] font-medium text-accent">
                            {providerModelCount}
                          </span>
                        )}
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

                        {/* Version + Update — single row */}
                        {provider.cliPath && (() => {
                          const update = cliUpdates[provider.id]
                          const isChecking = checkingUpdate[provider.id]
                          const updateCommand = update?.updateCommand
                          return (
                            <div className="mt-1.5 flex items-center gap-1.5 text-[11px]">
                              {isChecking ? (
                                <span className="flex items-center gap-1 text-text-secondary">
                                  <svg className="h-2.5 w-2.5 animate-spin" viewBox="0 0 24 24" fill="none">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                                  </svg>
                                  checking...
                                </span>
                              ) : update ? (
                                <span className="flex items-center gap-1.5">
                                  <span className="font-mono text-text-secondary">{update.currentVersion}</span>
                                  {update.hasUpdate ? (
                                    <>
                                      <span className="text-text-secondary">→</span>
                                      <span className="font-mono text-yellow-400">{update.latestVersion}</span>
                                      {updateCommand && (
                                        <button
                                          onClick={() => {
                                            void navigator.clipboard.writeText(updateCommand)
                                            setCopiedCmd(provider.id)
                                            setTimeout(() => { setCopiedCmd(null) }, 2000)
                                          }}
                                          className="ml-0.5 rounded border border-yellow-500/30 px-1 py-0.5 text-[10px] text-yellow-400 transition-colors hover:bg-yellow-500/10"
                                          title={updateCommand}
                                        >
                                          {copiedCmd === provider.id ? '✓ copied' : (
                                            <span className="flex items-center gap-1">
                                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-2.5 w-2.5">
                                                <path d="M5.5 3.5A1.5 1.5 0 0 1 7 2h2.879a1.5 1.5 0 0 1 1.06.44l2.122 2.12a1.5 1.5 0 0 1 .439 1.061V9.5A1.5 1.5 0 0 1 12 11V8.621a3 3 0 0 0-.879-2.121L9 4.379A3 3 0 0 0 6.879 3.5H5.5Z" />
                                                <path d="M4 5a1.5 1.5 0 0 0-1.5 1.5v6A1.5 1.5 0 0 0 4 14h5a1.5 1.5 0 0 0 1.5-1.5V8.621a1.5 1.5 0 0 0-.44-1.06L7.94 5.439A1.5 1.5 0 0 0 6.878 5H4Z" />
                                              </svg>
                                              upgrade cmd
                                            </span>
                                          )}
                                        </button>
                                      )}
                                    </>
                                  ) : (
                                    <span className="text-green-400">✓ latest</span>
                                  )}
                                </span>
                              ) : null}
                            </div>
                          )
                        })()}
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

                    {/* Available Models with toggles */}
                    {providerModels.length > 0 && (() => {
                      const disabledSet = new Set(model.disabledModels)
                      const enabledCount = providerModels.filter((m) => !disabledSet.has(m.id)).length
                      const allEnabled = enabledCount === providerModels.length

                      const toggleModel = (modelId: string) => {
                        const current = new Set(model.disabledModels)
                        if (current.has(modelId)) {
                          current.delete(modelId)
                        } else {
                          current.add(modelId)
                        }
                        updateGlobal('model', { ...model, disabledModels: [...current] })
                      }

                      const toggleAll = (enable: boolean) => {
                        if (enable) {
                          // Remove all this provider's models from disabled
                          const current = new Set(model.disabledModels)
                          for (const m of providerModels) current.delete(m.id)
                          updateGlobal('model', { ...model, disabledModels: [...current] })
                        } else {
                          // Add all this provider's models to disabled
                          const current = new Set(model.disabledModels)
                          for (const m of providerModels) current.add(m.id)
                          updateGlobal('model', { ...model, disabledModels: [...current] })
                        }
                      }

                      return (
                        <div>
                          <div className="mb-2 flex items-center justify-between">
                            <label className="text-xs font-medium text-text-secondary">
                              Models ({enabledCount}/{providerModels.length})
                            </label>
                            <button
                              onClick={() => { toggleAll(!allEnabled) }}
                              className="text-[10px] text-text-secondary transition-colors hover:text-text-primary"
                            >
                              {allEnabled ? 'Deselect all' : 'Select all'}
                            </button>
                          </div>
                          <div className="space-y-0.5">
                            {providerModels.map((m) => {
                              const enabled = !disabledSet.has(m.id)
                              return (
                                <div
                                  key={m.id}
                                  className={`flex items-center justify-between rounded-md px-2.5 py-1.5 transition-opacity ${
                                    enabled ? 'bg-surface-hover/50' : 'bg-surface-hover/20 opacity-50'
                                  }`}
                                >
                                  <div className="flex items-center gap-2">
                                    {/* Toggle */}
                                    <button
                                      onClick={() => { toggleModel(m.id) }}
                                      className={`relative h-4 w-7 rounded-full transition-colors ${
                                        enabled ? 'bg-accent' : 'bg-surface-hover'
                                      }`}
                                    >
                                      <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white shadow transition-all ${
                                        enabled ? 'left-3.5' : 'left-0.5'
                                      }`} />
                                    </button>
                                    <span className={`h-1.5 w-1.5 rounded-full ${
                                      m.tier === 'flagship' ? 'bg-purple-400' :
                                      m.tier === 'fast' ? 'bg-green-400' : 'bg-blue-400'
                                    }`} />
                                    <span className="text-xs font-medium text-text-primary">
                                      {m.displayName}
                                    </span>
                                    {m.alias && (
                                      <span className="rounded bg-surface-hover px-1 py-0.5 text-[10px] font-mono text-text-secondary">
                                        {m.alias}
                                      </span>
                                    )}
                                    {m.isNew && (
                                      <span className="rounded bg-accent/20 px-1 py-0.5 text-[10px] font-medium text-accent">
                                        New
                                      </span>
                                    )}
                                  </div>
                                  <span className="text-[10px] text-text-secondary">
                                    {String(Math.round(m.contextWindow / 1000))}k
                                  </span>
                                </div>
                              )
                            })}
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </SettingSection>

      <SettingSection title="Daily Token Budgets" description="Set model-level daily token budgets to get warning alerts at 80% usage. Leave blank to disable budget.">
        {budgetableModels.length > 0 ? (
          <div className="space-y-3">
            {budgetableModels.map((m) => {
              const budgetValue = model.dailyTokenBudgets[m.id]
              const displayValue = budgetValue ? String(budgetValue) : ''

              return (
                <SettingRow
                  key={m.id}
                  label={m.displayName}
                  description={`Model ID: ${m.id}`}
                  vertical
                >
                  <input
                    type="number"
                    value={displayValue}
                    onChange={(e) => { updateBudget(m.id, e.target.value) }}
                    placeholder="Unlimited"
                    min={1}
                    step={1000}
                    className="w-full rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-text-primary transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 md:max-w-xs"
                  />
                </SettingRow>
              )
            })}
          </div>
        ) : (
          <p className="text-sm text-text-secondary">No models available yet. Expand providers to load model list.</p>
        )}
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
