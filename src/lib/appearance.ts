import type { AppearanceConfig } from '@/types/settings'

// Default appearance config
export const DEFAULT_APPEARANCE: AppearanceConfig = {
  theme: 'system',
  accentColor: '#E8A87C',
  fontSize: 'medium',
  cardDensity: 'comfortable',
  animationSpeed: 'normal',
}

// Get stored appearance config from Zustand's persisted state
export function getAppearanceConfig(): AppearanceConfig {
  try {
    // Read from Zustand's persisted storage key
    const stored = localStorage.getItem('bento-settings')
    if (stored) {
      const parsed = JSON.parse(stored)
      // Zustand stores state in { state: { global: { appearance: ... } } }
      const appearance = parsed?.state?.global?.appearance
      if (appearance) {
        return { ...DEFAULT_APPEARANCE, ...appearance }
      }
    }
  } catch {
    // Ignore parse errors
  }
  return DEFAULT_APPEARANCE
}

// Apply accent color to CSS variable
export function setAccentColor(color: string): void {
  document.documentElement.style.setProperty('--accent', color)
}

// Apply font size via data attribute
export function setFontSize(size: AppearanceConfig['fontSize']): void {
  document.documentElement.dataset['fontSize'] = size
}

// Apply card density via data attribute
export function setCardDensity(density: AppearanceConfig['cardDensity']): void {
  document.documentElement.dataset['cardDensity'] = density
}

// Apply animation speed via data attribute
export function setAnimationSpeed(speed: AppearanceConfig['animationSpeed']): void {
  document.documentElement.dataset['animationSpeed'] = speed
}

// Apply all appearance settings to the DOM
export function applyAppearance(config: Partial<AppearanceConfig>): void {
  if (config.accentColor) {
    setAccentColor(config.accentColor)
  }
  if (config.fontSize) {
    setFontSize(config.fontSize)
  }
  if (config.cardDensity) {
    setCardDensity(config.cardDensity)
  }
  if (config.animationSpeed) {
    setAnimationSpeed(config.animationSpeed)
  }
}

// Initialize appearance on app start
export function initializeAppearance(): void {
  const config = getAppearanceConfig()
  applyAppearance(config)
}
