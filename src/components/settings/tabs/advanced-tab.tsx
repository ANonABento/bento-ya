import { useState } from 'react'
import { useSettingsStore } from '@/stores/settings-store'
import { DEFAULT_SETTINGS } from '@/types/settings'
import { SettingSection, SettingRow } from '@/components/shared/setting-components'
import { Toggle } from '@/components/shared/toggle'

type NumberFieldProps = {
  label: string
  description: string
  value: number
  onChange: (v: number) => void
  min: number
  max: number
  step?: number
  unit?: string
  width?: 'sm' | 'md' | 'lg'
}

function NumberField({ label, description, value, onChange, min, max, step = 1, unit, width = 'sm' }: NumberFieldProps) {
  const widthClass = width === 'lg' ? 'w-28' : width === 'md' ? 'w-24' : 'w-20'
  return (
    <SettingRow label={label} description={description}>
      <div className="flex items-center gap-2">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => { onChange(Number(e.target.value)) }}
          className={`${widthClass} rounded-lg border border-border-default bg-surface px-3 py-1.5 text-right text-sm tabular-nums text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20`}
        />
        {unit && <span className="text-xs text-text-secondary">{unit}</span>}
      </div>
    </SettingRow>
  )
}

export function AdvancedTab() {
  const settings = useSettingsStore((s) => s.global)
  const updateSettings = useSettingsStore((s) => s.updateGlobal)

  const terminal = settings.terminal
  const panel = settings.panel
  const gestures = settings.gestures
  const advanced = settings.advanced
  const workspaceDefaults = settings.workspaceDefaults

  const [showResetConfirm, setShowResetConfirm] = useState(false)

  const doReset = () => {
    updateSettings('terminal', DEFAULT_SETTINGS.terminal)
    updateSettings('panel', DEFAULT_SETTINGS.panel)
    updateSettings('gestures', DEFAULT_SETTINGS.gestures)
    updateSettings('advanced', DEFAULT_SETTINGS.advanced)
    updateSettings('workspaceDefaults', DEFAULT_SETTINGS.workspaceDefaults)
    setShowResetConfirm(false)
  }

  return (
    <div className="space-y-8">
      <p className="rounded-lg border border-border-default bg-surface/40 px-3 py-2 text-xs text-text-secondary">
        Power-user controls. Changes apply immediately and are persisted across restarts.
      </p>

      {/* ── Resource limits & timeouts ────────────────────────── */}
      <SettingSection
        title="Resource limits & timeouts"
        description="Caps on terminals and how long the app waits for an agent response."
      >
        <div className="space-y-3">
          <NumberField
            label="Max concurrent terminals"
            description="Active terminal sessions the app keeps in memory. Sessions beyond this are evicted (LRU)."
            value={advanced.maxConcurrentTerminals}
            onChange={(v) => { updateSettings('advanced', { ...advanced, maxConcurrentTerminals: v }) }}
            min={1}
            max={20}
          />
          <NumberField
            label="Agent response timeout"
            description="Kill an agent process that produces no output for this long."
            value={advanced.messageTimeoutSeconds}
            onChange={(v) => { updateSettings('advanced', { ...advanced, messageTimeoutSeconds: v }) }}
            min={30}
            max={600}
            step={30}
            unit="seconds"
            width="md"
          />
          <NumberField
            label="Settings sync debounce"
            description="Wait time before saving rapid changes. Lower = more saves; higher = less I/O."
            value={advanced.settingsSyncDebounceMs}
            onChange={(v) => { updateSettings('advanced', { ...advanced, settingsSyncDebounceMs: v }) }}
            min={100}
            max={2000}
            step={100}
            unit="ms"
            width="md"
          />
        </div>
      </SettingSection>

      {/* ── Terminal ──────────────────────────────────────────── */}
      <SettingSection
        title="Terminal"
        description="Appearance and input behavior for the embedded xterm.js terminals."
        border
      >
        <div className="space-y-3">
          <NumberField
            label="Max input rows"
            description="Lines visible in the chat input before scrolling."
            value={terminal.maxInputRows}
            onChange={(v) => { updateSettings('terminal', { ...terminal, maxInputRows: v }) }}
            min={1}
            max={20}
          />
          <NumberField
            label="Font size"
            description="Terminal text size."
            value={terminal.fontSize}
            onChange={(v) => { updateSettings('terminal', { ...terminal, fontSize: v }) }}
            min={10}
            max={24}
            unit="px"
          />
          <NumberField
            label="Line height"
            description="Vertical spacing between terminal lines."
            value={terminal.lineHeight}
            onChange={(v) => { updateSettings('terminal', { ...terminal, lineHeight: v }) }}
            min={12}
            max={32}
            unit="px"
          />
          <NumberField
            label="Scrollback lines"
            description="History buffer per terminal. Higher = more memory."
            value={terminal.scrollbackLines}
            onChange={(v) => { updateSettings('terminal', { ...terminal, scrollbackLines: v }) }}
            min={1000}
            max={50000}
            step={1000}
            width="md"
          />
        </div>
      </SettingSection>

      {/* ── Chef panel ────────────────────────────────────────── */}
      <SettingSection
        title="Chef panel"
        description="Bottom orchestrator panel sizing."
        border
      >
        <div className="space-y-3">
          <NumberField
            label="Default height"
            description="Initial size when the panel is opened."
            value={panel.defaultHeight}
            onChange={(v) => { updateSettings('panel', { ...panel, defaultHeight: v }) }}
            min={panel.minHeight}
            max={panel.maxHeight}
            step={50}
            unit="px"
            width="md"
          />
          <SettingRow
            label="Resize constraints"
            description="Minimum and maximum height when dragging the panel handle."
          >
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={100}
                max={panel.maxHeight - 50}
                step={50}
                value={panel.minHeight}
                onChange={(e) => { updateSettings('panel', { ...panel, minHeight: Number(e.target.value) }) }}
                className="w-20 rounded-lg border border-border-default bg-surface px-3 py-1.5 text-right text-sm tabular-nums text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                aria-label="Minimum panel height"
              />
              <span className="text-xs text-text-secondary">to</span>
              <input
                type="number"
                min={panel.minHeight + 50}
                max={1200}
                step={50}
                value={panel.maxHeight}
                onChange={(e) => { updateSettings('panel', { ...panel, maxHeight: Number(e.target.value) }) }}
                className="w-20 rounded-lg border border-border-default bg-surface px-3 py-1.5 text-right text-sm tabular-nums text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
                aria-label="Maximum panel height"
              />
              <span className="text-xs text-text-secondary">px</span>
            </div>
          </SettingRow>
        </div>
      </SettingSection>

      {/* ── Gestures ──────────────────────────────────────────── */}
      <SettingSection
        title="Gestures"
        description="Touchpad and mouse-wheel behavior across workspaces."
        border
      >
        <div className="space-y-3">
          <SettingRow
            label="Swipe navigation"
            description="Two-finger swipe to switch workspaces."
          >
            <Toggle
              checked={gestures.swipeEnabled}
              onChange={(v) => { updateSettings('gestures', { ...gestures, swipeEnabled: v }) }}
              size="md"
            />
          </SettingRow>
          <div className={gestures.swipeEnabled ? 'space-y-3' : 'pointer-events-none space-y-3 opacity-50'}>
            <NumberField
              label="Swipe distance threshold"
              description="Minimum pixels of horizontal travel to trigger a swap."
              value={gestures.swipeThreshold}
              onChange={(v) => { updateSettings('gestures', { ...gestures, swipeThreshold: v }) }}
              min={20}
              max={200}
              unit="px"
            />
            <NumberField
              label="Swipe velocity threshold"
              description="Minimum speed (px/ms) to trigger from a short flick."
              value={gestures.swipeVelocityThreshold}
              onChange={(v) => { updateSettings('gestures', { ...gestures, swipeVelocityThreshold: v }) }}
              min={0.1}
              max={2}
              step={0.1}
              unit="px/ms"
            />
          </div>
        </div>
      </SettingSection>

      {/* ── New workspace defaults ────────────────────────────── */}
      <SettingSection
        title="New workspace defaults"
        description="Used as the starting template when you create a new workspace. Existing workspaces aren't affected."
        border
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm text-text-primary">Default columns</label>
            <p className="mt-0.5 text-xs text-text-secondary">Comma-separated list. Each becomes a column on the new workspace board.</p>
            <input
              type="text"
              value={workspaceDefaults.defaultColumns.join(', ')}
              onChange={(e) => {
                updateSettings('workspaceDefaults', {
                  ...workspaceDefaults,
                  defaultColumns: e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
                })
              }}
              className="mt-2 w-full rounded-lg border border-border-default bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              placeholder="Backlog, Working, Review, Done"
            />
          </div>
          <SettingRow
            label="Branch prefix"
            description="Prepended to auto-generated task branches (e.g. bentoya/feat-add-login)."
          >
            <input
              type="text"
              value={workspaceDefaults.branchPrefix}
              onChange={(e) => { updateSettings('workspaceDefaults', { ...workspaceDefaults, branchPrefix: e.target.value }) }}
              className="w-40 rounded-lg border border-border-default bg-surface px-3 py-1.5 text-sm font-mono text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              placeholder="bentoya/"
            />
          </SettingRow>
          <SettingRow
            label="Auto-stash prefix"
            description="Prefix used when the app stashes uncommitted changes before switching task worktrees."
          >
            <input
              type="text"
              value={workspaceDefaults.autoStashPrefix}
              onChange={(e) => { updateSettings('workspaceDefaults', { ...workspaceDefaults, autoStashPrefix: e.target.value }) }}
              className="w-40 rounded-lg border border-border-default bg-surface px-3 py-1.5 text-sm font-mono text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20"
              placeholder="bentoya-auto-stash-"
            />
          </SettingRow>
        </div>
      </SettingSection>

      {/* ── Reset (visually de-escalated danger zone) ────────── */}
      <SettingSection title="Reset" border>
        {!showResetConfirm ? (
          <div className="rounded-lg border border-border-default bg-surface/40 p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-text-primary">Restore advanced settings to defaults</p>
                <p className="mt-0.5 text-xs text-text-secondary">
                  Resets terminal, panel, gestures, performance, and new-workspace defaults. Does not touch providers, models, voice, or appearance.
                </p>
              </div>
              <button
                onClick={() => { setShowResetConfirm(true) }}
                className="shrink-0 rounded-lg border border-border-default px-3 py-1.5 text-sm text-text-secondary transition-colors hover:border-accent hover:text-text-primary"
              >
                Reset…
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3 rounded-lg border border-yellow-500/40 bg-yellow-500/5 p-4">
            <p className="text-sm font-medium text-text-primary">Reset 5 sections to defaults?</p>
            <p className="text-xs text-text-secondary">
              This is reversible only by setting values back manually. Provider, model, voice, and appearance settings are untouched.
            </p>
            <div className="flex gap-2">
              <button
                onClick={doReset}
                className="rounded-lg bg-yellow-500 px-4 py-2 text-sm font-medium text-bg transition-colors hover:bg-yellow-400"
              >
                Yes, reset
              </button>
              <button
                onClick={() => { setShowResetConfirm(false) }}
                className="rounded-lg border border-border-default px-4 py-2 text-sm text-text-secondary transition-colors hover:bg-surface"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </SettingSection>
    </div>
  )
}
