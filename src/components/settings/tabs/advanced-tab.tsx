import { useState } from 'react'
import { useSettingsStore } from '@/stores/settings-store'
import { DEFAULT_SETTINGS } from '@/types/settings'
import {
  checkUpdateIfAvailable,
  installPendingUpdate,
  isTauriRuntime,
  type AppUpdateResult,
} from '@/lib/update'

export function AdvancedTab() {
  const settings = useSettingsStore((s) => s.global)
  const updateSettings = useSettingsStore((s) => s.updateGlobal)
  const [appUpdate, setAppUpdate] = useState<AppUpdateResult | null>(null)
  const [updateStatus, setUpdateStatus] = useState<{
    type: 'success' | 'error'
    message: string
  } | null>(null)
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false)
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false)

  const terminal = settings.terminal
  const panel = settings.panel
  const gestures = settings.gestures
  const advanced = settings.advanced
  const workspaceDefaults = settings.workspaceDefaults

  const clearUpdateMessage = () => {
    setUpdateStatus(null)
  }

  const handleCheckForUpdate = async () => {
    if (!isTauriRuntime()) {
      setUpdateStatus({
        type: 'error',
        message: 'App updates are available only in the desktop app',
      })
      return
    }

    setIsCheckingUpdate(true)
    setUpdateStatus(null)
    try {
      const update = await checkUpdateIfAvailable()
      setAppUpdate(update)
      if (update) {
        setUpdateStatus({ type: 'success', message: `Version ${update.version} is available` })
      } else {
        setUpdateStatus({ type: 'success', message: 'You are on the latest version' })
      }
      setTimeout(clearUpdateMessage, 4000)
    } catch (error: unknown) {
      setUpdateStatus({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to check for updates',
      })
    } finally {
      setIsCheckingUpdate(false)
    }
  }

  const handleInstallUpdate = async () => {
    setIsInstallingUpdate(true)
    try {
      await installPendingUpdate()
      setAppUpdate(null)
      setUpdateStatus({
        type: 'success',
        message: 'Update installed. Restart the app to complete the update.',
      })
      setTimeout(clearUpdateMessage, 5000)
    } catch (error: unknown) {
      setUpdateStatus({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to install update',
      })
    } finally {
      setIsInstallingUpdate(false)
    }
  }

  return (
    <div className="space-y-8">
      {/* Terminal Settings */}
      <section>
        <h3 className="mb-4 text-sm font-medium text-text-primary">Terminal Input</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-primary">Max input rows</p>
              <p className="text-xs text-text-secondary">Maximum lines before scrolling</p>
            </div>
            <input
              type="number"
              min={1}
              max={20}
              value={terminal.maxInputRows}
              onChange={(e) => {
                updateSettings('terminal', { ...terminal, maxInputRows: Number(e.target.value) })
              }}
              className="w-20 rounded border border-border-default bg-surface px-2 py-1 text-sm text-text-primary"
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-primary">Line height</p>
              <p className="text-xs text-text-secondary">Pixels per line</p>
            </div>
            <input
              type="number"
              min={12}
              max={40}
              value={terminal.lineHeight}
              onChange={(e) => {
                updateSettings('terminal', { ...terminal, lineHeight: Number(e.target.value) })
              }}
              className="w-20 rounded border border-border-default bg-surface px-2 py-1 text-sm text-text-primary"
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-primary">Scrollback lines</p>
              <p className="text-xs text-text-secondary">Terminal history buffer</p>
            </div>
            <input
              type="number"
              min={1000}
              max={50000}
              step={1000}
              value={terminal.scrollbackLines}
              onChange={(e) => {
                updateSettings('terminal', { ...terminal, scrollbackLines: Number(e.target.value) })
              }}
              className="w-24 rounded border border-border-default bg-surface px-2 py-1 text-sm text-text-primary"
            />
          </div>
        </div>
      </section>

      {/* Panel Settings */}
      <section>
        <h3 className="mb-4 text-sm font-medium text-text-primary">Chef Panel</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-primary">Default height</p>
              <p className="text-xs text-text-secondary">Initial panel height in pixels</p>
            </div>
            <input
              type="number"
              min={panel.minHeight}
              max={panel.maxHeight}
              step={50}
              value={panel.defaultHeight}
              onChange={(e) => {
                updateSettings('panel', { ...panel, defaultHeight: Number(e.target.value) })
              }}
              className="w-24 rounded border border-border-default bg-surface px-2 py-1 text-sm text-text-primary"
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-primary">Min / Max height</p>
              <p className="text-xs text-text-secondary">Resize constraints</p>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={100}
                max={panel.maxHeight - 50}
                step={50}
                value={panel.minHeight}
                onChange={(e) => {
                  updateSettings('panel', { ...panel, minHeight: Number(e.target.value) })
                }}
                className="w-20 rounded border border-border-default bg-surface px-2 py-1 text-sm text-text-primary"
              />
              <span className="text-text-secondary">/</span>
              <input
                type="number"
                min={panel.minHeight + 50}
                max={1200}
                step={50}
                value={panel.maxHeight}
                onChange={(e) => {
                  updateSettings('panel', { ...panel, maxHeight: Number(e.target.value) })
                }}
                className="w-20 rounded border border-border-default bg-surface px-2 py-1 text-sm text-text-primary"
              />
            </div>
          </div>
        </div>
      </section>

      {/* Gesture Settings */}
      <section>
        <h3 className="mb-4 text-sm font-medium text-text-primary">Gestures</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-primary">Swipe navigation</p>
              <p className="text-xs text-text-secondary">Swipe to switch workspaces</p>
            </div>
            <button
              onClick={() => {
                updateSettings('gestures', { ...gestures, swipeEnabled: !gestures.swipeEnabled })
              }}
              className={`relative h-6 w-11 rounded-full transition-colors ${
                gestures.swipeEnabled ? 'bg-accent' : 'bg-surface-hover'
              }`}
            >
              <span
                className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  gestures.swipeEnabled ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
          {gestures.swipeEnabled && (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-text-primary">Swipe threshold</p>
                  <p className="text-xs text-text-secondary">Minimum distance in pixels</p>
                </div>
                <input
                  type="number"
                  min={20}
                  max={200}
                  value={gestures.swipeThreshold}
                  onChange={(e) => {
                    updateSettings('gestures', {
                      ...gestures,
                      swipeThreshold: Number(e.target.value),
                    })
                  }}
                  className="w-20 rounded border border-border-default bg-surface px-2 py-1 text-sm text-text-primary"
                />
              </div>
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-text-primary">Velocity threshold</p>
                  <p className="text-xs text-text-secondary">Minimum swipe speed (px/ms)</p>
                </div>
                <input
                  type="number"
                  min={0.1}
                  max={2}
                  step={0.1}
                  value={gestures.swipeVelocityThreshold}
                  onChange={(e) => {
                    updateSettings('gestures', {
                      ...gestures,
                      swipeVelocityThreshold: Number(e.target.value),
                    })
                  }}
                  className="w-20 rounded border border-border-default bg-surface px-2 py-1 text-sm text-text-primary"
                />
              </div>
            </>
          )}
        </div>
      </section>

      {/* Advanced/Performance Settings */}
      <section>
        <h3 className="mb-4 text-sm font-medium text-text-primary">Performance</h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-primary">Settings sync debounce</p>
              <p className="text-xs text-text-secondary">Delay before saving changes (ms)</p>
            </div>
            <input
              type="number"
              min={100}
              max={2000}
              step={100}
              value={advanced.settingsSyncDebounceMs}
              onChange={(e) => {
                updateSettings('advanced', {
                  ...advanced,
                  settingsSyncDebounceMs: Number(e.target.value),
                })
              }}
              className="w-24 rounded border border-border-default bg-surface px-2 py-1 text-sm text-text-primary"
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-primary">Message timeout</p>
              <p className="text-xs text-text-secondary">Agent response timeout (seconds)</p>
            </div>
            <input
              type="number"
              min={30}
              max={600}
              step={30}
              value={advanced.messageTimeoutSeconds}
              onChange={(e) => {
                updateSettings('advanced', {
                  ...advanced,
                  messageTimeoutSeconds: Number(e.target.value),
                })
              }}
              className="w-24 rounded border border-border-default bg-surface px-2 py-1 text-sm text-text-primary"
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-primary">Max concurrent terminals</p>
              <p className="text-xs text-text-secondary">Limit active terminal sessions</p>
            </div>
            <input
              type="number"
              min={1}
              max={20}
              value={advanced.maxConcurrentTerminals}
              onChange={(e) => {
                updateSettings('advanced', {
                  ...advanced,
                  maxConcurrentTerminals: Number(e.target.value),
                })
              }}
              className="w-20 rounded border border-border-default bg-surface px-2 py-1 text-sm text-text-primary"
            />
          </div>
        </div>
      </section>

      {/* Workspace Defaults */}
      <section>
        <h3 className="mb-4 text-sm font-medium text-text-primary">Workspace Defaults</h3>
        <div className="space-y-4">
          <div>
            <p className="mb-2 text-sm text-text-primary">Default columns</p>
            <p className="mb-2 text-xs text-text-secondary">
              Comma-separated column names for new workspaces
            </p>
            <input
              type="text"
              value={workspaceDefaults.defaultColumns.join(', ')}
              onChange={(e) => {
                updateSettings('workspaceDefaults', {
                  ...workspaceDefaults,
                  defaultColumns: e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }}
              className="w-full rounded border border-border-default bg-surface px-3 py-2 text-sm text-text-primary"
              placeholder="Backlog, Working, Review, Done"
            />
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-text-primary">Branch prefix</p>
              <p className="text-xs text-text-secondary">Prefix for auto-created branches</p>
            </div>
            <input
              type="text"
              value={workspaceDefaults.branchPrefix}
              onChange={(e) => {
                updateSettings('workspaceDefaults', {
                  ...workspaceDefaults,
                  branchPrefix: e.target.value,
                })
              }}
              className="w-32 rounded border border-border-default bg-surface px-2 py-1 text-sm text-text-primary font-mono"
            />
          </div>
        </div>
      </section>

      <section>
        <h3 className="mb-4 text-sm font-medium text-text-primary">App Updates</h3>
        <p className="mb-3 text-xs text-text-secondary">
          Check GitHub releases for the latest version.
        </p>
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-text-primary">Update status</span>
            <button
              onClick={() => {
                void handleCheckForUpdate()
              }}
              disabled={isCheckingUpdate}
              className="rounded-lg border border-border-default px-3 py-2 text-sm transition-colors hover:border-accent hover:text-text-primary disabled:opacity-50"
              style={{ cursor: isCheckingUpdate ? 'default' : 'pointer' }}
            >
              {isCheckingUpdate ? 'Checking…' : 'Check for updates'}
            </button>
          </div>

          {updateStatus && (
            <div
              className={`rounded-md px-3 py-2 text-xs ${
                updateStatus.type === 'success'
                  ? 'bg-green-500/10 text-green-400'
                  : 'bg-red-500/10 text-red-400'
              }`}
            >
              {updateStatus.message}
            </div>
          )}

          {appUpdate && (
            <div className="space-y-2 rounded-md border border-accent/30 bg-accent/10 p-2.5">
              <p className="text-xs text-text-primary">
                Version <span className="font-mono">{appUpdate.version}</span> is available.
              </p>
              <button
                onClick={() => {
                  void handleInstallUpdate()
                }}
                disabled={isInstallingUpdate}
                className="rounded-lg border border-accent bg-accent/10 px-3 py-2 text-sm text-text-primary transition-colors hover:bg-accent/20 disabled:opacity-50"
                style={{ cursor: isInstallingUpdate ? 'default' : 'pointer' }}
              >
                {isInstallingUpdate ? 'Installing…' : 'Install update'}
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Reset */}
      <section className="pt-4 border-t border-border-default">
        <button
          onClick={() => {
            updateSettings('terminal', DEFAULT_SETTINGS.terminal)
            updateSettings('panel', DEFAULT_SETTINGS.panel)
            updateSettings('gestures', DEFAULT_SETTINGS.gestures)
            updateSettings('advanced', DEFAULT_SETTINGS.advanced)
            updateSettings('workspaceDefaults', DEFAULT_SETTINGS.workspaceDefaults)
          }}
          className="text-sm text-text-secondary hover:text-error transition-colors"
        >
          Reset advanced settings to defaults
        </button>
      </section>
    </div>
  )
}
