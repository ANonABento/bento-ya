import { useSettingsStore } from '@/stores/settings-store'
import type { ShortcutConfig } from '@/types/settings'
import { Toggle } from '@/components/shared/toggle'

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
          Customize keyboard shortcuts. Toggle to enable/disable, edit the key binding on the right.
        </p>
      </div>

      <div className="space-y-1">
        {shortcuts.map((shortcut) => (
          <div
            key={shortcut.id}
            className={`flex items-center justify-between rounded-lg border border-border-default p-3 transition-colors ${
              !shortcut.enabled ? 'opacity-50' : ''
            }`}
          >
            <div className="flex items-center gap-3">
              <Toggle
                checked={shortcut.enabled}
                onChange={(checked) => updateShortcut(shortcut.id, { enabled: checked })}
              />
              <span className="text-sm text-text-primary">{shortcut.action}</span>
            </div>
            <input
              type="text"
              value={shortcut.keys}
              onChange={(e) => updateShortcut(shortcut.id, { keys: e.target.value })}
              disabled={!shortcut.enabled}
              className="w-28 rounded-lg border border-border-default bg-surface px-2 py-1.5 text-center font-mono text-sm text-text-primary transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-50"
            />
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-warning/30 bg-warning/5 p-4">
        <p className="text-xs text-text-secondary">
          <span className="font-medium text-warning">Note:</span> Some system shortcuts cannot be overridden. Conflicting shortcuts will be highlighted.
        </p>
      </div>
    </div>
  )
}
