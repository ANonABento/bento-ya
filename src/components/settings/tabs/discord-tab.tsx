import { useEffect, useState } from 'react'
import { SettingSection, SettingRow, SettingInput } from '@/components/shared/setting-components'
import { Toggle } from '@/components/shared/toggle'
import {
  discordGetConfig,
  discordStatus,
  discordTestConnection,
  discordSaveConfig,
} from '@/lib/ipc/discord'

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'ok'; tag: string | null }
  | { kind: 'error'; message: string }

export function DiscordTab() {
  const [enabled, setEnabled] = useState(false)
  const [hasToken, setHasToken] = useState(false)
  const [token, setToken] = useState('') // empty = keep existing saved token
  const [channelId, setChannelId] = useState('')
  const [running, setRunning] = useState(false)
  const [test, setTest] = useState<TestState>({ kind: 'idle' })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const cfg = await discordGetConfig()
        setEnabled(cfg.enabled)
        setHasToken(cfg.hasToken)
        setChannelId(cfg.threadChannelId)
        const st = await discordStatus()
        setRunning(st.running)
      } catch {
        /* settings not reachable — leave defaults */
      }
    })()
  }, [])

  const handleTest = async () => {
    setTest({ kind: 'testing' })
    try {
      // Test the typed token; if none typed but one is saved, the user should
      // type it again to re-test (we never read the saved token back to JS).
      if (!token.trim()) {
        setTest({ kind: 'error', message: 'Enter the bot token to test.' })
        return
      }
      const res = await discordTestConnection(token.trim())
      setTest({ kind: 'ok', tag: res.tag })
    } catch (err) {
      setTest({ kind: 'error', message: err instanceof Error ? err.message : String(err) })
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveError(null)
    try {
      const res = await discordSaveConfig({
        enabled,
        token: token.trim() || undefined, // omit → keep the saved token
        threadChannelId: channelId.trim(),
      })
      setEnabled(res.enabled)
      setHasToken(res.hasToken)
      setChannelId(res.threadChannelId)
      setRunning(res.running)
      setToken('') // clear the input; the token is now persisted server-side
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-6">
      <SettingSection
        title="Discord"
        description="Mirror the board to Discord: each task gets a thread with its agent's output streaming in (KaitenCode → Discord). Reply-routing and #chef come later — see .tickets/discord/MVP-PLAN.md."
      >
        <SettingRow
          label="Enable Discord"
          description={
            running
              ? 'Sidecar bot running.'
              : enabled
                ? 'Enabled (bot will connect on save / app start).'
                : 'Off. Requires a bot token + a channel for task threads.'
          }
        >
          <Toggle checked={enabled} onChange={setEnabled} aria-label="Enable Discord" />
        </SettingRow>
      </SettingSection>

      <SettingSection
        title="Bot token"
        description={
          hasToken
            ? 'A token is saved. Leave blank to keep it, or paste a new one to replace it.'
            : 'Create a bot at discord.com/developers, enable the Message Content intent, and paste its token. Invite it with Create Public Threads + Send Messages in Threads.'
        }
      >
        <div className="space-y-2">
          <input
            type="password"
            value={token}
            onChange={(e) => { setToken(e.target.value) }}
            placeholder={hasToken ? '•••••••••• (saved)' : 'Bot token'}
            className="w-full rounded-md border border-border-default bg-bg px-3 py-2 font-mono text-xs text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none"
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => { void handleTest() }}
              disabled={test.kind === 'testing'}
              className="rounded-md border border-border-default bg-surface px-3 py-1 text-xs font-medium text-text-secondary hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
              style={{ cursor: test.kind === 'testing' ? 'wait' : 'pointer' }}
            >
              {test.kind === 'testing' ? 'Testing…' : 'Test connection'}
            </button>
            {test.kind === 'ok' && (
              <span className="text-xs text-running">✓ Connected as {test.tag ?? 'bot'}</span>
            )}
            {test.kind === 'error' && (
              <span className="text-xs text-error" title={test.message}>✗ {test.message}</span>
            )}
          </div>
        </div>
      </SettingSection>

      <SettingSection
        title="Task-thread channel"
        description="Channel ID where per-task threads are created (right-click a channel → Copy Channel ID; Developer Mode must be on). MVP uses one channel for all task threads."
      >
        <SettingInput
          value={channelId}
          onChange={setChannelId}
          placeholder="123456789012345678"
          mono
        />
      </SettingSection>

      <div className="flex items-center gap-3 border-t border-border-default pt-4">
        <button
          type="button"
          onClick={() => { void handleSave() }}
          disabled={saving}
          className="rounded-md border border-accent/40 bg-accent/15 px-4 py-1.5 text-xs font-medium text-accent hover:bg-accent/25 disabled:opacity-50"
          style={{ cursor: saving ? 'wait' : 'pointer' }}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {saveError && <span className="text-xs text-error" title={saveError}>{saveError}</span>}
        {!saveError && running && <span className="text-xs text-text-secondary">Bot is running.</span>}
      </div>
    </div>
  )
}
