import { useSettingsStore } from '@/stores/settings-store'
import type { ShortcutConfig } from '@/types/settings'

export function ShortcutsTab() {
  const global = useSettingsStore((s) => s.global)
  const updateGlobal = useSettingsStore((s) => s.updateGlobal)
  const shortcuts = global.shortcuts

  const updateShortcut = (id: string, updates: Partial<ShortcutConfig>) => {
    const updated = shortcuts.map((s) => (s.id === id ? { ...s, ...updates } : s))
    updateGlobal('shortcuts', updated)
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border-default bg-surface/50 p-4">
        <p className="text-sm text-text-secondary">
          Customize keyboard shortcuts. Click on a shortcut to edit, or toggle to enable/disable.
        </p>
      </div>

      <div className="space-y-2">
        {shortcuts.map((shortcut) => (
          <div
            key={shortcut.id}
            className={`flex items-center justify-between rounded-lg border p-3 transition-colors ${
              shortcut.enabled ? 'border-border-default' : 'border-border-default/50 opacity-50'
            }`}
          >
            <div className="flex items-center gap-4">
              <label className="flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={shortcut.enabled}
                  onChange={(e) => updateShortcut(shortcut.id, { enabled: e.target.checked })}
                  className="h-4 w-4 rounded border-border-default text-accent focus:ring-accent"
                />
              </label>
              <span className="text-sm text-text-primary">{shortcut.action}</span>
            </div>
            <input
              type="text"
              value={shortcut.keys}
              onChange={(e) => updateShortcut(shortcut.id, { keys: e.target.value })}
              disabled={!shortcut.enabled}
              className="w-32 rounded-lg border border-border-default bg-bg px-2 py-1 text-center font-mono text-sm text-text-primary focus:border-accent focus:outline-none disabled:opacity-50"
            />
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-warning/30 bg-warning/10 p-4">
        <p className="text-sm text-warning">
          Conflicting shortcuts will be highlighted. Some system shortcuts cannot be overridden.
        </p>
      </div>
    </div>
  )
}
