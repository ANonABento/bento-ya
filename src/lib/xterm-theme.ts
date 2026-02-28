import type { ITheme } from '@xterm/xterm'
import type { Theme } from './theme'

export const xtermDarkTheme: ITheme = {
  background: '#0D0D0D',
  foreground: '#E5E5E5',
  cursor: '#E8A87C',
  cursorAccent: '#0D0D0D',
  selectionBackground: 'rgba(232, 168, 124, 0.3)',
  selectionForeground: '#E5E5E5',

  // Standard ANSI colors
  black: '#1A1A1A',
  red: '#E06C75',
  green: '#98C379',
  yellow: '#E5C07B',
  blue: '#61AFEF',
  magenta: '#C678DD',
  cyan: '#56B6C2',
  white: '#ABB2BF',

  // Bright ANSI colors
  brightBlack: '#5C6370',
  brightRed: '#E06C75',
  brightGreen: '#98C379',
  brightYellow: '#E5C07B',
  brightBlue: '#61AFEF',
  brightMagenta: '#C678DD',
  brightCyan: '#56B6C2',
  brightWhite: '#F5F5F5',
}

export const xtermLightTheme: ITheme = {
  background: '#FAFAF9',
  foreground: '#1C1917',
  cursor: '#C2703E',
  cursorAccent: '#FAFAF9',
  selectionBackground: 'rgba(194, 112, 62, 0.3)',
  selectionForeground: '#1C1917',

  // Standard ANSI colors (adapted for light background)
  black: '#1C1917',
  red: '#DC2626',
  green: '#16A34A',
  yellow: '#CA8A04',
  blue: '#2563EB',
  magenta: '#9333EA',
  cyan: '#0891B2',
  white: '#F5F5F4',

  // Bright ANSI colors
  brightBlack: '#78716C',
  brightRed: '#EF4444',
  brightGreen: '#22C55E',
  brightYellow: '#EAB308',
  brightBlue: '#3B82F6',
  brightMagenta: '#A855F7',
  brightCyan: '#06B6D4',
  brightWhite: '#FFFFFF',
}

export function getXtermTheme(theme: Theme): ITheme {
  return theme === 'light' ? xtermLightTheme : xtermDarkTheme
}
