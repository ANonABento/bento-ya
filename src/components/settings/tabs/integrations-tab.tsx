import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useSettingsStore } from '@/stores/settings-store'

type DiscordStatus = {
  connected: boolean
  ready: boolean
  user?: {
    id: string
    tag: string
    username: string
  }
  guildId?: string
  guildName?: string
}

export function IntegrationsTab() {
  const global = useSettingsStore((s) => s.global)
  const updateGlobal = useSettingsStore((s) => s.updateGlobal)

  const [showToken, setShowToken] = useState(false)
  const [status, setStatus] = useState<DiscordStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [testResult, setTestResult] = useState<string | null>(null)

  const discord = global.discord

  // Fetch status on mount
  useEffect(() => {
    fetchStatus()
  }, [])

  const fetchStatus = useCallback(async () => {
    try {
      const result = await invoke<DiscordStatus>('get_discord_status')
      setStatus(result)
    } catch {
      setStatus(null)
    }
  }, [])

  const handleToggleEnabled = async (enabled: boolean) => {
    updateGlobal('discord', { ...discord, enabled })

    if (enabled && discord.botToken && discord.guildId) {
      await handleConnect()
    } else if (!enabled) {
      await handleDisconnect()
    }
  }

  const handleConnect = async () => {
    if (!discord.botToken) {
      setError('Bot token is required')
      return
    }

    setLoading(true)
    setError(null)

    try {
      // First spawn the sidecar
      await invoke('spawn_discord_sidecar')

      // Then connect with token
      const result = await invoke<DiscordStatus>('connect_discord', {
        token: discord.botToken,
        guildId: discord.guildId || null,
      })

      setStatus(result)
      setTestResult('Connected successfully!')
      setTimeout(() => setTestResult(null), 3000)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  const handleDisconnect = async () => {
    setLoading(true)
    try {
      await invoke('disconnect_discord')
      await invoke('kill_discord_sidecar')
      setStatus(null)
    } catch {
      // Ignore disconnect errors
    } finally {
      setLoading(false)
    }
  }

  const handleTestConnection = async () => {
    setLoading(true)
    setError(null)
    setTestResult(null)

    try {
      // Spawn sidecar if not running
      await invoke('spawn_discord_sidecar')

      // Connect
      const connectResult = await invoke<DiscordStatus>('connect_discord', {
        token: discord.botToken,
        guildId: discord.guildId || null,
      })

      // Ping
      await invoke('test_discord_connection')

      setStatus(connectResult)
      setTestResult(`Connected as ${connectResult.user?.tag || 'unknown'}`)

      // Disconnect if not meant to stay connected
      if (!discord.enabled) {
        await handleDisconnect()
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium text-text-primary">Integrations</h3>
        <p className="text-sm text-text-secondary">Connect external services to Bento-ya</p>
      </div>

      {/* Discord Section */}
      <div className="rounded-lg border border-border-default bg-surface p-4">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#5865F2]">
              <svg className="h-6 w-6 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03zM8.02 15.33c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.956-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.956 2.418-2.157 2.418zm7.975 0c-1.183 0-2.157-1.085-2.157-2.419 0-1.333.955-2.419 2.157-2.419 1.21 0 2.176 1.096 2.157 2.42 0 1.333-.946 2.418-2.157 2.418z"/>
              </svg>
            </div>
            <div>
              <h4 className="font-medium text-text-primary">Discord</h4>
              <p className="text-xs text-text-secondary">Connect a Discord bot to mirror your workspace</p>
            </div>
          </div>
          <label className="relative inline-flex cursor-pointer items-center">
            <input
              type="checkbox"
              checked={discord.enabled}
              onChange={(e) => handleToggleEnabled(e.target.checked)}
              className="peer sr-only"
            />
            <div className="peer h-6 w-11 rounded-full bg-border-default after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-accent peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none" />
          </label>
        </div>

        <div className="space-y-4">
          {/* Bot Token */}
          <div>
            <label className="mb-1 block text-sm font-medium text-text-primary">Bot Token</label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <input
                  type={showToken ? 'text' : 'password'}
                  value={discord.botToken}
                  onChange={(e) => updateGlobal('discord', { ...discord, botToken: e.target.value })}
                  placeholder="Enter your Discord bot token"
                  className="w-full rounded-lg border border-border-default bg-bg px-3 py-2 pr-10 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => setShowToken(!showToken)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-text-secondary hover:text-text-primary"
                >
                  {showToken ? (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                      <path fillRule="evenodd" d="M3.28 2.22a.75.75 0 0 0-1.06 1.06l14.5 14.5a.75.75 0 1 0 1.06-1.06l-1.745-1.745a10.029 10.029 0 0 0 3.3-4.38 1.651 1.651 0 0 0 0-1.185A10.004 10.004 0 0 0 9.999 3a9.956 9.956 0 0 0-4.744 1.194L3.28 2.22ZM7.752 6.69l1.092 1.092a2.5 2.5 0 0 1 3.374 3.373l1.091 1.092a4 4 0 0 0-5.557-5.557Z" clipRule="evenodd" />
                      <path d="m10.748 13.93 2.523 2.523a9.987 9.987 0 0 1-3.27.547c-4.258 0-7.894-2.66-9.337-6.41a1.651 1.651 0 0 1 0-1.186A10.007 10.007 0 0 1 2.839 6.02L6.07 9.252a4 4 0 0 0 4.678 4.678Z" />
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5">
                      <path d="M10 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z" />
                      <path fillRule="evenodd" d="M.664 10.59a1.651 1.651 0 0 1 0-1.186A10.004 10.004 0 0 1 10 3c4.257 0 7.893 2.66 9.336 6.41.147.381.146.804 0 1.186A10.004 10.004 0 0 1 10 17c-4.257 0-7.893-2.66-9.336-6.41ZM14 10a4 4 0 1 1-8 0 4 4 0 0 1 8 0Z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              </div>
            </div>
            <p className="mt-1 text-xs text-text-muted">
              Create a bot at{' '}
              <a href="https://discord.com/developers/applications" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                discord.com/developers
              </a>
            </p>
          </div>

          {/* Server ID */}
          <div>
            <label className="mb-1 block text-sm font-medium text-text-primary">Server ID</label>
            <input
              type="text"
              value={discord.guildId}
              onChange={(e) => updateGlobal('discord', { ...discord, guildId: e.target.value })}
              placeholder="Enter Discord server ID"
              className="w-full rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
            />
            <p className="mt-1 text-xs text-text-muted">
              Enable Developer Mode in Discord settings, then right-click your server to copy ID
            </p>
          </div>

          {/* Auto-connect */}
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-text-primary">Auto-connect on startup</p>
              <p className="text-xs text-text-secondary">Connect to Discord when Bento-ya starts</p>
            </div>
            <label className="relative inline-flex cursor-pointer items-center">
              <input
                type="checkbox"
                checked={discord.autoConnect}
                onChange={(e) => updateGlobal('discord', { ...discord, autoConnect: e.target.checked })}
                className="peer sr-only"
              />
              <div className="peer h-5 w-9 rounded-full bg-border-default after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-accent peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none" />
            </label>
          </div>

          {/* Status & Actions */}
          <div className="flex items-center justify-between border-t border-border-default pt-4">
            <div className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${
                  status?.ready ? 'bg-green-500' : status?.connected ? 'bg-yellow-500' : 'bg-text-muted'
                }`}
              />
              <span className="text-sm text-text-secondary">
                {status?.ready
                  ? `Connected as ${status.user?.tag}`
                  : status?.connected
                  ? 'Connecting...'
                  : 'Disconnected'}
              </span>
            </div>
            <div className="flex gap-2">
              {status?.ready ? (
                <button
                  onClick={handleDisconnect}
                  disabled={loading}
                  className="rounded-lg border border-border-default bg-bg px-3 py-1.5 text-sm text-text-primary transition-colors hover:bg-surface disabled:opacity-50"
                >
                  Disconnect
                </button>
              ) : (
                <button
                  onClick={handleTestConnection}
                  disabled={loading || !discord.botToken}
                  className="rounded-lg bg-[#5865F2] px-3 py-1.5 text-sm text-white transition-colors hover:bg-[#4752C4] disabled:opacity-50"
                >
                  {loading ? 'Testing...' : 'Test Connection'}
                </button>
              )}
            </div>
          </div>

          {/* Error/Success Messages */}
          {error && (
            <div className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-500">
              {error}
            </div>
          )}
          {testResult && (
            <div className="rounded-lg bg-green-500/10 px-3 py-2 text-sm text-green-500">
              {testResult}
            </div>
          )}
        </div>
      </div>

      {/* Future integrations placeholder */}
      <div className="rounded-lg border border-dashed border-border-default p-4 text-center">
        <p className="text-sm text-text-muted">More integrations coming soon...</p>
      </div>
    </div>
  )
}
