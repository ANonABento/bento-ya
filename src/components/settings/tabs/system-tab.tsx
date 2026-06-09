import { useEffect, useState } from 'react'
import { SettingSection, SettingRow } from '@/components/shared/setting-components'
import { getAppSettings, updateAppSettings, type AppSettings } from '@/lib/ipc/settings'

/**
 * Global backend settings (`~/.kaitencode/settings.json` via get/update_app_settings).
 * These were previously only editable by hand-editing the JSON. See the settings
 * audit — this tab closes the "no UI" gap for AppSettings.
 */
export function SystemTab() {
  const [s, setS] = useState<AppSettings | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getAppSettings()
      .then(setS)
      .catch((e: unknown) => { setError(e instanceof Error ? e.message : String(e)) })
  }, [])

  const commit = (patch: Partial<AppSettings>) => {
    setS((prev) => (prev ? { ...prev, ...patch } : prev))
    void updateAppSettings(patch).catch((e: unknown) => {
      setError(e instanceof Error ? e.message : String(e))
    })
  }

  if (!s) {
    return <div className="text-sm text-text-secondary">{error ?? 'Loading…'}</div>
  }

  return (
    <div className="space-y-6">
      {error && <div className="rounded-md bg-error/10 px-3 py-2 text-xs text-error">{error}</div>}

      <SettingSection
        title="Global defaults"
        description="Fallbacks when a workspace, column, or task doesn't specify its own. Per-workspace overrides (Workspace tab) win over these."
      >
        <SettingRow label="Default agent CLI" description="Which AI CLI new agents use by default.">
          <Select
            value={s.default_agent_cli}
            onChange={(v) => { commit({ default_agent_cli: v }) }}
            options={[{ value: 'claude', label: 'Claude' }, { value: 'codex', label: 'Codex' }]}
          />
        </SettingRow>
        <SettingRow label="Default model" description="Empty = use the CLI's own default.">
          <Text value={s.default_model} placeholder="(CLI default)" onCommit={(v) => { commit({ default_model: v }) }} mono />
        </SettingRow>
        <SettingRow label="Session strategy" description="Reuse a task's existing agent session, or start fresh each run.">
          <Select
            value={s.default_session_strategy}
            onChange={(v) => { commit({ default_session_strategy: v }) }}
            options={[{ value: 'fresh', label: 'Fresh' }, { value: 'reuse', label: 'Reuse' }]}
          />
        </SettingRow>
        <SettingRow label="Advance mode" description="Whether tasks auto-advance through columns or wait for you.">
          <Select
            value={s.default_advance_mode}
            onChange={(v) => { commit({ default_advance_mode: v }) }}
            options={[{ value: 'auto', label: 'Auto' }, { value: 'manual', label: 'Manual' }]}
          />
        </SettingRow>
      </SettingSection>

      <SettingSection
        title="Sessions & cleanup"
        description="Lifecycle of agent tmux sessions and archived tasks."
        border
      >
        <SettingRow label="Max agent sessions" description="Global ceiling on live agent tmux sessions.">
          <Num value={s.max_agent_sessions} min={1} onCommit={(v) => { commit({ max_agent_sessions: v }) }} />
        </SettingRow>
        <SettingRow label="GC interval (minutes)" description="How often the garbage collector sweeps stale sessions.">
          <Num value={s.gc_interval_minutes} min={1} onCommit={(v) => { commit({ gc_interval_minutes: v }) }} />
        </SettingRow>
        <SettingRow label="Idle sleep (minutes)" description="Detach a session after this long idle.">
          <Num value={s.idle_sleep_minutes} min={1} onCommit={(v) => { commit({ idle_sleep_minutes: v }) }} />
        </SettingRow>
        <SettingRow label="Idle kill (hours)" description="Kill a session after this long idle.">
          <Num value={s.idle_kill_hours} min={1} onCommit={(v) => { commit({ idle_kill_hours: v }) }} />
        </SettingRow>
        <SettingRow label="Archive purge (days)" description="Permanently delete archived tasks after this many days.">
          <Num value={s.archive_purge_days} min={1} onCommit={(v) => { commit({ archive_purge_days: v }) }} />
        </SettingRow>
      </SettingSection>

      <SettingSection title="Limits" description="Guard-rails and version checks." border>
        <SettingRow
          label="MCP recursion depth"
          description="Max depth of an agent-spawned task chain (human → agent → agent…). Raise if you hit 'recursion depth exceeded'."
        >
          <Num value={s.mcp_max_recursion_depth} min={0} onCommit={(v) => { commit({ mcp_max_recursion_depth: v }) }} />
        </SettingRow>
        <SettingRow label="Claude min version" description="Warn at startup if installed Claude is older. Empty = accept any.">
          <Text value={s.claude_min_version ?? ''} placeholder="(any)" onCommit={(v) => { commit({ claude_min_version: v }) }} mono />
        </SettingRow>
        <SettingRow label="Codex min version" description="Warn at startup if installed Codex is older. Empty = accept any.">
          <Text value={s.codex_min_version ?? ''} placeholder="(any)" onCommit={(v) => { commit({ codex_min_version: v }) }} mono />
        </SettingRow>
      </SettingSection>
    </div>
  )
}

// ─── Local field controls ─────────────────────────────────────────────────

function Select({
  value,
  onChange,
  options,
}: {
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <select
      value={value}
      onChange={(e) => { onChange(e.target.value) }}
      className="rounded-md border border-border-default bg-bg px-2.5 py-1.5 text-sm text-text-primary focus:border-accent focus:outline-none"
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>{o.label}</option>
      ))}
    </select>
  )
}

/** Commits on blur / Enter so we don't write settings.json on every keystroke. */
function Text({
  value,
  placeholder,
  onCommit,
  mono = false,
}: {
  value: string
  placeholder?: string
  onCommit: (v: string) => void
  mono?: boolean
}) {
  const [local, setLocal] = useState(value)
  useEffect(() => { setLocal(value) }, [value])
  return (
    <input
      type="text"
      value={local}
      placeholder={placeholder}
      onChange={(e) => { setLocal(e.target.value) }}
      onBlur={() => { if (local !== value) onCommit(local.trim()) }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      className={`w-40 rounded-md border border-border-default bg-bg px-2.5 py-1.5 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none ${mono ? 'font-mono' : ''}`}
    />
  )
}

function Num({
  value,
  min,
  onCommit,
}: {
  value: number
  min: number
  onCommit: (v: number) => void
}) {
  const [local, setLocal] = useState(String(value))
  useEffect(() => { setLocal(String(value)) }, [value])
  return (
    <input
      type="number"
      min={min}
      step={1}
      value={local}
      onChange={(e) => { setLocal(e.target.value) }}
      onBlur={() => {
        const n = Number.parseInt(local, 10)
        if (Number.isFinite(n) && n >= min && n !== value) onCommit(n)
        else setLocal(String(value))
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
      className="w-28 rounded-md border border-border-default bg-bg px-2.5 py-1.5 text-sm text-text-primary focus:border-accent focus:outline-none"
    />
  )
}
