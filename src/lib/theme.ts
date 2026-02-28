export type Theme = 'dark' | 'light'

export function getTheme(): Theme {
  return (document.documentElement.dataset['theme'] as Theme | undefined) ?? 'dark'
}

export function setTheme(theme: Theme): void {
  document.documentElement.dataset['theme'] = theme
}
