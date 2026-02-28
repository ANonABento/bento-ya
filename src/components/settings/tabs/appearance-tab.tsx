import { useSettingsStore } from '@/stores/settings-store'
import { useThemeStore } from '@/stores/theme-store'
import type { ThemePreference } from '@/lib/theme'
import type { AppearanceConfig } from '@/types/settings'

const ACCENT_COLORS = [
  { id: 'terracotta', value: '#E8A87C', label: 'Terracotta' },
  { id: 'blue', value: '#60A5FA', label: 'Blue' },
  { id: 'green', value: '#4ADE80', label: 'Green' },
  { id: 'purple', value: '#A78BFA', label: 'Purple' },
  { id: 'pink', value: '#F472B6', label: 'Pink' },
  { id: 'orange', value: '#FB923C', label: 'Orange' },
]

export function AppearanceTab() {
  const global = useSettingsStore((s) => s.global)
  const updateGlobal = useSettingsStore((s) => s.updateGlobal)
  const themePreference = useThemeStore((s) => s.preference)
  const setThemePreference = useThemeStore((s) => s.setPreference)

  const appearance = global.appearance

  const updateAppearance = (updates: Partial<AppearanceConfig>) => {
    updateGlobal('appearance', { ...appearance, ...updates })
  }

  return (
    <div className="space-y-8">
      <section>
        <h3 className="mb-4 text-sm font-medium text-text-primary">Theme</h3>
        <div className="flex gap-2">
          {(['system', 'light', 'dark'] as const).map((theme) => (
            <button
              key={theme}
              onClick={() => {
                setThemePreference(theme as ThemePreference)
                updateAppearance({ theme })
              }}
              className={`rounded-lg border px-4 py-2 text-sm capitalize transition-colors ${
                themePreference === theme
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border-default text-text-secondary hover:border-accent/50'
              }`}
            >
              {theme}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-4 text-sm font-medium text-text-primary">Accent Color</h3>
        <div className="flex flex-wrap gap-2">
          {ACCENT_COLORS.map((color) => (
            <button
              key={color.id}
              onClick={() => updateAppearance({ accentColor: color.value })}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                appearance.accentColor === color.value
                  ? 'border-accent bg-accent/10'
                  : 'border-border-default hover:border-accent/50'
              }`}
            >
              <span
                className="h-4 w-4 rounded-full"
                style={{ backgroundColor: color.value }}
              />
              <span className="text-text-secondary">{color.label}</span>
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-4 text-sm font-medium text-text-primary">Font Size</h3>
        <div className="flex gap-2">
          {(['small', 'medium', 'large'] as const).map((size) => (
            <button
              key={size}
              onClick={() => updateAppearance({ fontSize: size })}
              className={`rounded-lg border px-4 py-2 text-sm capitalize transition-colors ${
                appearance.fontSize === size
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border-default text-text-secondary hover:border-accent/50'
              }`}
            >
              {size}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-4 text-sm font-medium text-text-primary">Card Density</h3>
        <div className="flex gap-2">
          {(['compact', 'comfortable', 'spacious'] as const).map((density) => (
            <button
              key={density}
              onClick={() => updateAppearance({ cardDensity: density })}
              className={`rounded-lg border px-4 py-2 text-sm capitalize transition-colors ${
                appearance.cardDensity === density
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border-default text-text-secondary hover:border-accent/50'
              }`}
            >
              {density}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3 className="mb-4 text-sm font-medium text-text-primary">Animation Speed</h3>
        <div className="flex gap-2">
          {(['none', 'reduced', 'normal'] as const).map((speed) => (
            <button
              key={speed}
              onClick={() => updateAppearance({ animationSpeed: speed })}
              className={`rounded-lg border px-4 py-2 text-sm capitalize transition-colors ${
                appearance.animationSpeed === speed
                  ? 'border-accent bg-accent/10 text-accent'
                  : 'border-border-default text-text-secondary hover:border-accent/50'
              }`}
            >
              {speed}
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
