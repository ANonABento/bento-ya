export type Theme = 'dark' | 'light'
export type ThemePreference = Theme | 'system'

const STORAGE_KEY = 'bento-theme-preference'

// Get the resolved theme (what's actually applied)
export function getTheme(): Theme {
  return (document.documentElement.dataset['theme'] as Theme | undefined) ?? 'dark'
}

// Get user's stored preference
export function getThemePreference(): ThemePreference {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === 'dark' || stored === 'light' || stored === 'system') {
    return stored
  }
  return 'system'
}

// Resolve 'system' to actual theme based on OS preference
export function resolveTheme(preference: ThemePreference): Theme {
  if (preference === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  return preference
}

// Apply theme to document
export function setTheme(theme: Theme): void {
  document.documentElement.dataset['theme'] = theme
}

// Save preference and apply
export function setThemePreference(preference: ThemePreference): void {
  localStorage.setItem(STORAGE_KEY, preference)
  setTheme(resolveTheme(preference))
}

// Initialize theme on app start
export function initializeTheme(): () => void {
  const preference = getThemePreference()
  setTheme(resolveTheme(preference))

  // Watch for system theme changes
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  const handleChange = () => {
    if (getThemePreference() === 'system') {
      setTheme(resolveTheme('system'))
    }
  }

  mediaQuery.addEventListener('change', handleChange)

  // Return cleanup function
  return () => {
    mediaQuery.removeEventListener('change', handleChange)
  }
}
