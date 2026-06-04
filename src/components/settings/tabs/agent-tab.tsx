import { useState, useEffect } from 'react'
import { useSettingsStore } from '@/stores/settings-store'
import type { AgentConfig, ProviderConfig } from '@/types/settings'
import { detectSingleCli, checkCliUpdate, getAppSettings, updateAppSettings, type DetectedCli, type CliUpdateInfo } from '@/lib/ipc'
import { useModels } from '@/hooks/use-models'
import { SettingSection, SettingRow, SettingInput, SettingSlider } from '@/components/shared/setting-components'
import { Dropdown } from '@/components/shared/dropdown'
import { Toggle } from '@/components/shared/toggle'
import { getModelBudgetKey } from '@/lib/usage-budget'

const PROVIDER_INFO: Record<string, { name: string; description: string; cliId: string; supportsApi: boolean }> = {
  anthropic: {
    name: 'Anthropic',
    description: 'Claude models via CLI or ANTHROPIC_API_KEY',
    cliId: 'claude',
    supportsApi: true,
  },
  openai: {
    name: 'OpenAI',
    description: 'Codex models via CLI',
    cliId: 'codex',
    supportsApi: false,
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

  // Global agent-runtime settings live in the backend AppSettings
  // (~/.kaitencode/settings.json), not the persisted zustand store — the
  // pipeline resolver reads them at the global tier. Load + write via IPC.
  const [defaultRuntimeMode, setDefaultRuntimeMode] = useState('')
  const [interactiveEnabled, setInteractiveEnabled] = useState(false)
  const [runtimeSettingsLoaded, setRuntimeSettingsLoaded] = useState(false)

  useEffect(() => {
    let cancelled = false
    getAppSettings()
      .then((s) => {
        if (cancelled) return
        setDefaultRuntimeMode(s.default_runtime_mode)
        setInteractiveEnabled(s.interactive_mode_enabled)
        setRuntimeSettingsLoaded(true)
      })
      .catch((err: unknown) => { console.error("Failed to load app settings:", err) })
    return () => { cancelled = true }
  }, [])

  const persistRuntimeSetting = (updates: { default_runtime_mode?: string; interactive_mode_enabled?: boolean }) => {
    void updateAppSettings(updates).catch((err: unknown) => {
      console.error('Failed to update app settings:', err)
    })
  }

  const handleDefaultRuntimeModeChange = (value: string) => {
    setDefaultRuntimeMode(value)
    persistRuntimeSetting({ default_runtime_mode: value })
  }

  const handleInteractiveEnabledChange = (enabled: boolean) => {
    setInteractiveEnabled(enabled)
    // Turning the gate off while interactive is the global default would leave
    // the resolver downgrading every task — clear the default in lock-step.
    if (!enabled && defaultRuntimeMode === 'interactive') {
      setDefaultRuntimeMode('')
      persistRuntimeSetting({ interactive_mode_enabled: false, default_runtime_mode: '' })
    } else {
      persistRuntimeSetting({ interactive_mode_enabled: enabled })
    }
  }

  const updateAgent = (updates: Partial<AgentConfig>) => {
    updateGlobal('agent', { ...agent, ...updates })
  }

  const updateProvider = (providerId: string, updates: Partial<ProviderConfig>) => {
    const providers = model.providers.map((p) =>
      p.id === providerId ? { ...p, ...updates } : p
    )
    updateGlobal('model', { ...model, providers })
  }

  // Get all available models from enabled providers, excluding disabled ones
  const enabledProviderIds = new Set(model.providers.filter((p) => p.enabled).map((p) => p.id))
  const disabledModelIds = new Set(model.disabledModels)
  const availableModels = allModels
    .filter((m) => enabledProviderIds.has(m.provider) && !disabledModelIds.has(m.id))
    .map((m) => m.id)
  const budgetModels = allModels
    .filter((m) => enabledProviderIds.has(m.provider) && !disabledModelIds.has(m.id))
    .sort((a, b) => a.displayName.localeCompare(b.displayName))

  const enabledProviderCount = model.providers.filter((p) => p.enabled).length
  const totalEnabledModels = availableModels.length
  const budgetCount = Object.keys(model.dailyBudgetsUsd).length

  const updateDailyBudget = (budgetKey: string, value: string) => {
    const parsed = Number.parseFloat(value)
    const nextBudgets = { ...model.dailyBudgetsUsd }

    if (!Number.isFinite(parsed) || parsed <= 0) {
      Reflect.deleteProperty(nextBudgets, budgetKey)
    } else {
      nextBudgets[budgetKey] = parsed
    }

    updateGlobal('model', { ...model, dailyBudgetsUsd: nextBudgets })
  }

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

    // Keep manually-entered absolute/custom paths, but verify default binary
    // names such as "claude" or "codex" instead of treating them as detected.
    const provider = model.providers.find((p) => p.id === providerId)
    if (provider?.cliPath && provider.cliPath !== cliId) return

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
      } else {
        updateProvider(providerId, { cliPath: undefined })
      }
    } catch (err) {
      console.error('Failed to detect CLI:', err)
    } finally {
      setDetecting((prev) => ({ ...prev, [providerId]: false }))
    }
  }

  return (
    <div className="space-y-8">
      {/* Quick status header — at-a-glance state */}
      <div className="grid grid-cols-3 gap-3">
        <StatusTile
          label="Active providers"
          value={`${String(enabledProviderCount)} / ${String(model.providers.length)}`}
          tone={enabledProviderCount > 0 ? 'ok' : 'warn'}
        />
        <StatusTile
          label="Models available"
          value={String(totalEnabledModels)}
          tone={totalEnabledModels > 0 ? 'ok' : 'warn'}
        />
        <StatusTile
          label="Permission mode"
          value={agent.defaultPermissionMode === 'full' ? 'Full (risky)' : 'Plan (safe)'}
          tone={agent.defaultPermissionMode === 'full' ? 'danger' : 'ok'}
        />
      </div>

      {/* ── 1. PROVIDERS ─────────────────────────────────────── */}
      <SettingSection
        title="Providers"
        description="Connect AI providers via their CLI. Direct API mode is available for Anthropic when ANTHROPIC_API_KEY is set in the app environment."
      >
        <div className="mb-3 flex items-center justify-between gap-3">
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
            className={`mb-3 rounded-md px-3 py-1.5 text-xs transition-all ${
              refreshStatus.type === 'success'
                ? 'bg-green-500/10 text-green-400'
                : 'bg-yellow-500/10 text-yellow-400'
            }`}
          >
            {refreshStatus.message}
          </div>
        )}
        <div className="space-y-3">
          {model.providers.map((provider) => {
            const info = PROVIDER_INFO[provider.id]
            if (!info) return null
            const isExpanded = expanded[provider.id] && provider.enabled
            const providerModels = allModels.filter((m) => m.provider === provider.id)
            const providerModelCount = providerModels.length
            const cliId = info.cliId
            const supportsApi = info.supportsApi
            const connectionMode = supportsApi ? provider.connectionMode : 'cli'
            const detectedCli = detectedClis[cliId]
            const isDetectedCli = Boolean(
              provider.cliPath &&
              detectedCli?.isAvailable &&
              detectedCli.path === provider.cliPath,
            )

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

                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      handleToggleProvider(provider.id, !provider.enabled)
                    }}
                    className={`relative h-6 w-11 rounded-full transition-colors ${
                      provider.enabled ? 'bg-accent' : 'bg-surface-hover'
                    }`}
                    aria-label={`${provider.enabled ? 'Disable' : 'Enable'} ${info.name}`}
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
                      <label className="mb-1.5 block text-xs font-medium text-text-secondary">
                        Connection Mode
                      </label>
                      <div className="flex gap-2">
                        <button
                          onClick={() => { void handleCliModeSelect(provider.id) }}
                          disabled={detecting[provider.id]}
                          className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                            connectionMode === 'cli'
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
                          onClick={() => {
                            if (supportsApi) updateProvider(provider.id, { connectionMode: 'api' })
                          }}
                          disabled={!supportsApi}
                          className={`flex-1 rounded-lg border px-3 py-2 text-sm transition-colors ${
                            connectionMode === 'api'
                              ? 'border-accent bg-accent/10 text-text-primary'
                              : 'border-border-default text-text-secondary hover:border-accent/50'
                          } disabled:opacity-40 disabled:hover:border-border-default`}
                        >
                          {supportsApi ? 'API' : 'API unavailable'}
                        </button>
                      </div>
                      <p className="mt-1.5 text-[11px] text-text-secondary/80">
                        {connectionMode === 'cli'
                          ? 'Uses the installed CLI (auth and billing handled by the CLI).'
                          : supportsApi
                            ? `Uses ${provider.apiKeyEnvVar} from the app environment. Requests bill to your provider account.`
                            : 'Direct API streaming is not wired for this provider yet; use the CLI connection.'}
                      </p>
                    </div>

                    {/* CLI Path */}
                    {connectionMode === 'cli' && (
                      <div>
                        <label className="mb-1.5 flex items-center gap-2 text-xs font-medium text-text-secondary">
                          CLI Path
                          {isDetectedCli && (
                            <span className="flex items-center gap-1 text-green-500">
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                                <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
                              </svg>
                              Auto-detected
                            </span>
                          )}
                          {provider.cliPath && !isDetectedCli && (
                            <span className="text-text-secondary/80">Configured manually</span>
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
                            CLI not found. Install it or enter the path manually.
                          </p>
                        )}

                        {/* Version + Update */}
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
                                          {copiedCmd === provider.id ? '✓ copied' : 'copy upgrade cmd'}
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

                    {/* API Key */}
                    {connectionMode === 'api' && supportsApi && (
                      <div>
                        <label className="mb-1.5 block text-xs font-medium text-text-secondary">
                          API Key Source
                        </label>
                        <div className="rounded border border-border bg-bg-tertiary px-3 py-2 font-mono text-xs text-text-secondary">
                          Environment variable required: {provider.apiKeyEnvVar}
                        </div>
                      </div>
                    )}

                    {/* Available Models */}
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
                        const current = new Set(model.disabledModels)
                        if (enable) {
                          for (const m of providerModels) current.delete(m.id)
                        } else {
                          for (const m of providerModels) current.add(m.id)
                        }
                        updateGlobal('model', { ...model, disabledModels: [...current] })
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
                                    <button
                                      onClick={() => { toggleModel(m.id) }}
                                      className={`relative h-4 w-7 rounded-full transition-colors ${
                                        enabled ? 'bg-accent' : 'bg-surface-hover'
                                      }`}
                                      aria-label={`${enabled ? 'Disable' : 'Enable'} ${m.displayName}`}
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

        {/* Coming Soon — collapsed by default, less visual weight */}
        <div className="mt-3 border-t border-border-default/50 pt-3">
          <button
            onClick={() => { setComingSoonCollapsed(!comingSoonCollapsed) }}
            className="flex w-full items-center justify-between text-xs text-text-secondary transition-colors hover:text-text-primary"
          >
            <span>{comingSoonCollapsed ? 'Show upcoming providers' : 'Hide upcoming providers'}</span>
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className={`h-4 w-4 transition-transform ${comingSoonCollapsed ? '' : 'rotate-180'}`}
            >
              <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clipRule="evenodd" />
            </svg>
          </button>
          {!comingSoonCollapsed && (
            <div className="mt-2 space-y-2">
              {COMING_SOON.map((item) => (
                <div key={item.name} className="rounded-lg border border-border-default bg-surface/40 p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-primary">{item.name}</span>
                    <span className="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-text-secondary">
                      Coming soon
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-text-secondary/70">{item.description}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </SettingSection>

      {/* ── 2. ORCHESTRATOR & CONCURRENCY ────────────────────── */}
      <SettingSection
        title="Orchestrator & Concurrency"
        description="How the orchestrator picks models, and how many agents can run at once."
        border
      >
        <div className="space-y-5">
          <SettingRow
            label="Default model"
            description="Used when the orchestrator decides, or when triggers / tasks don't specify a model."
            vertical
          >
            <Dropdown
              options={[
                { value: 'auto', label: 'Auto', description: 'Orchestrator picks per task' },
                ...availableModels.map((m) => ({ value: m, label: m })),
              ]}
              value={agent.modelSelection}
              onChange={(value) => { updateAgent({ modelSelection: value }) }}
            />
          </SettingRow>

          <SettingRow
            label="Max concurrent agents"
            description="Cap on agents running simultaneously across all workspaces. Workspace-level limits apply on top of this."
            vertical
          >
            <SettingSlider
              value={agent.maxConcurrentAgents}
              onChange={(value) => { updateAgent({ maxConcurrentAgents: value }) }}
              min={1}
              max={50}
            />
          </SettingRow>
        </div>
      </SettingSection>

      {/* ── 2b. AGENT RUNTIME ─────────────────────────────────── */}
      <SettingSection
        title="Agent runtime"
        description="How trigger-spawned agents run by default. Headless pipes the CLI for a transcript or terminal view; interactive opens the real CLI TUI you can drive live."
        border
      >
        <div className="space-y-5">
          <SettingRow
            label="Enable interactive mode"
            description="Allow tasks to run as a live CLI TUI. Billing differs: interactive uses your CLI subscription's interactive limits, while headless bills against API / Agent-SDK credit. Headless stays the default either way."
            vertical
          >
            <Toggle
              checked={interactiveEnabled}
              onChange={handleInteractiveEnabledChange}
              disabled={!runtimeSettingsLoaded}
              size="md"
              aria-label="Enable interactive runtime mode"
            />
          </SettingRow>

          <SettingRow
            label="Default runtime mode"
            description="Applied when a column trigger, task, or workspace doesn't specify its own runtime mode."
            vertical
          >
            <Dropdown
              options={[
                { value: '', label: 'Auto', description: 'Headless · bubbles (recommended default)' },
                { value: 'managed', label: 'Headless · bubbles', description: 'Semantic event stream as chat bubbles' },
                { value: 'terminal', label: 'Headless · terminal', description: 'Raw tmux pane in xterm.js' },
                ...(interactiveEnabled || defaultRuntimeMode === 'interactive'
                  ? [{ value: 'interactive', label: 'Interactive', description: 'Live CLI TUI you can steer' }]
                  : []),
              ]}
              value={defaultRuntimeMode}
              onChange={handleDefaultRuntimeModeChange}
            />
          </SettingRow>
        </div>
      </SettingSection>

      {/* ── 3. PERMISSIONS (formerly hidden — surfaces a dangerous mode) ──── */}
      <SettingSection
        title="Default permission mode"
        description="Sets the starting permission for new agent chats. Each session can still be changed in the chat input."
        border
      >
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          <PermissionCard
            active={agent.defaultPermissionMode === 'plan'}
            onClick={() => { updateAgent({ defaultPermissionMode: 'plan' }) }}
            label="Plan"
            tone="safe"
            tag="Recommended"
            description="Read-only. Agents can analyze code and suggest plans, but cannot execute commands or modify files."
          />
          <PermissionCard
            active={agent.defaultPermissionMode === 'full'}
            onClick={() => { updateAgent({ defaultPermissionMode: 'full' }) }}
            label="Full"
            tone="danger"
            tag="Dangerous"
            description="Bypasses all permission prompts. Agents can run any command and modify any file without confirmation. Use only in sandboxes or worktrees you trust."
          />
        </div>
        {agent.defaultPermissionMode === 'full' && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 h-4 w-4 shrink-0 text-red-400">
              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" clipRule="evenodd" />
            </svg>
            <div className="text-xs text-red-300">
              <p className="font-medium">Full permissions are active by default.</p>
              <p className="mt-0.5 text-red-300/80">
                Agents will execute commands, write files, and run scripts without asking. Use per-task worktrees to limit blast radius.
              </p>
            </div>
          </div>
        )}
      </SettingSection>

      {/* ── 4. DAILY BUDGETS ─────────────────────────────────── */}
      <SettingSection
        title="Daily model budgets"
        description={
          budgetCount > 0
            ? `Show a board warning at 80% of the daily cap. ${String(budgetCount)} budget${budgetCount === 1 ? '' : 's'} set.`
            : 'Set a USD cap per model. The board warns when today\'s usage hits 80%.'
        }
        border
      >
        {budgetModels.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border-default px-3 py-4 text-sm text-text-secondary">
            Enable a provider and at least one model to set daily budgets.
          </p>
        ) : (
          <div className="space-y-2">
            {budgetModels.map((entry) => {
              const budgetKey = getModelBudgetKey(entry.id, entry.provider)
              const budget = model.dailyBudgetsUsd[budgetKey]
              const providerName = model.providers.find((provider) => provider.id === entry.provider)?.name ?? entry.provider

              return (
                <div
                  key={budgetKey}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border-default bg-surface/50 px-3 py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-text-primary">
                      {entry.displayName}
                    </div>
                    <div className="truncate text-xs text-text-secondary">
                      {providerName} · {entry.id}
                    </div>
                  </div>
                  <label className="flex shrink-0 items-center gap-2">
                    <span className="text-xs text-text-secondary">$</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={budget === undefined ? '' : String(budget)}
                      onChange={(event) => { updateDailyBudget(budgetKey, event.target.value) }}
                      placeholder="0.00"
                      className="w-24 rounded-lg border border-border-default bg-surface px-2 py-1.5 text-right text-sm tabular-nums text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                      aria-label={`${entry.displayName} daily budget`}
                    />
                    <span className="text-[10px] text-text-secondary/60">/day</span>
                  </label>
                </div>
              )
            })}
          </div>
        )}
      </SettingSection>
    </div>
  )
}

// ─── Small atoms ─────────────────────────────────────────────

type Tone = 'ok' | 'warn' | 'danger'

function StatusTile({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  const accent =
    tone === 'danger'
      ? 'border-red-500/30 bg-red-500/5 text-red-300'
      : tone === 'warn'
        ? 'border-yellow-500/30 bg-yellow-500/5 text-yellow-300'
        : 'border-border-default bg-surface/50 text-text-primary'
  return (
    <div className={`rounded-lg border px-3 py-2 ${accent}`}>
      <div className="text-[10px] uppercase tracking-wider text-text-secondary/80">{label}</div>
      <div className="mt-0.5 text-sm font-semibold tabular-nums">{value}</div>
    </div>
  )
}

function PermissionCard({
  active,
  onClick,
  label,
  description,
  tone,
  tag,
}: {
  active: boolean
  onClick: () => void
  label: string
  description: string
  tone: 'safe' | 'danger'
  tag?: string
}) {
  const activeRing =
    tone === 'danger' ? 'border-red-500 bg-red-500/10' : 'border-accent bg-accent/10'
  const tagStyle =
    tone === 'danger'
      ? 'bg-red-500/20 text-red-300'
      : 'bg-green-500/15 text-green-400'
  return (
    <button
      onClick={onClick}
      type="button"
      className={`flex flex-col items-start rounded-lg border p-3 text-left transition-colors ${
        active ? activeRing : 'border-border-default hover:border-accent/40'
      }`}
    >
      <div className="flex w-full items-center justify-between">
        <span className="text-sm font-semibold text-text-primary">{label}</span>
        {tag && (
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tagStyle}`}>
            {tag}
          </span>
        )}
      </div>
      <p className="mt-1.5 text-xs leading-relaxed text-text-secondary">{description}</p>
    </button>
  )
}
