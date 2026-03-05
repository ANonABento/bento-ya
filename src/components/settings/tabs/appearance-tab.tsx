import { useSettingsStore } from '@/stores/settings-store'
import { useThemeStore } from '@/stores/theme-store'
import type { ThemePreference } from '@/lib/theme'
import type { AppearanceConfig } from '@/types/settings'
import { SegmentedControl } from '@/components/shared/segmented-control'
import { AccentColorPicker } from '@/components/shared/accent-color-picker'
import { DensityPicker } from '@/components/shared/density-picker'
import { LabeledSlider } from '@/components/shared/labeled-slider'

const THEME_ICONS = {
  system: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
    </svg>
  ),
  light: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  ),
  dark: (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
    </svg>
  ),
}

const FONT_SIZE_LABELS = {
  small: 'S',
  medium: 'M',
  large: 'L',
}

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
      {/* Theme */}
      <section>
        <h3 className="mb-3 text-sm font-medium text-text-primary">Theme</h3>
        <SegmentedControl
          options={['system', 'light', 'dark'] as const}
          value={themePreference}
          onChange={(theme) => {
            setThemePreference(theme)
            updateAppearance({ theme })
          }}
          icons={THEME_ICONS}
          labels={{ system: 'System', light: 'Light', dark: 'Dark' }}
        />
      </section>

      {/* Accent Color */}
      <section>
        <h3 className="mb-3 text-sm font-medium text-text-primary">Accent Color</h3>
        <AccentColorPicker
          value={appearance.accentColor}
          onChange={(color) => { updateAppearance({ accentColor: color }); }}
        />
      </section>

      {/* Font Size */}
      <section>
        <h3 className="mb-3 text-sm font-medium text-text-primary">Font Size</h3>
        <SegmentedControl
          options={['small', 'medium', 'large'] as const}
          value={appearance.fontSize}
          onChange={(size) => { updateAppearance({ fontSize: size }); }}
          labels={FONT_SIZE_LABELS}
        />
      </section>

      {/* Card Density */}
      <section>
        <h3 className="mb-3 text-sm font-medium text-text-primary">Card Density</h3>
        <DensityPicker
          value={appearance.cardDensity}
          onChange={(density) => { updateAppearance({ cardDensity: density }); }}
        />
      </section>

      {/* Animation Speed */}
      <section>
        <h3 className="mb-3 text-sm font-medium text-text-primary">Animation Speed</h3>
        <LabeledSlider
          options={['none', 'reduced', 'normal'] as const}
          value={appearance.animationSpeed}
          onChange={(speed) => { updateAppearance({ animationSpeed: speed }); }}
          labels={{ none: 'None', reduced: 'Reduced', normal: 'Normal' }}
        />
      </section>
    </div>
  )
}
