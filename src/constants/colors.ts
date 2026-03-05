// Centralized color constants
// Single source of truth for design colors used across the app

// ─── Accent Color Presets ───────────────────────────────────────────────────
// Used in accent-color-picker, column-config-dialog, and appearance settings

export const ACCENT_COLORS = {
  CORAL: '#E8A87C',
  ROSE: '#E879A0',
  VIOLET: '#A78BFA',
  BLUE: '#60A5FA',
  CYAN: '#22D3EE',
  TEAL: '#2DD4BF',
  GREEN: '#4ADE80',
  LIME: '#A3E635',
  YELLOW: '#FACC15',
  ORANGE: '#FB923C',
} as const

export const ACCENT_COLOR_PRESETS = Object.values(ACCENT_COLORS)

export const DEFAULT_ACCENT_COLOR = ACCENT_COLORS.CORAL

// ─── Status Colors ──────────────────────────────────────────────────────────
// Used for agent status, pipeline state, reviews, etc.

export const STATUS_COLORS = {
  SUCCESS: '#4ADE80',
  ERROR: '#F87171',
  WARNING: '#F59E0B',
  ATTENTION: '#FBBF24',
  INFO: '#60A5FA',
  PURPLE: '#A78BFA',
  PINK: '#EC4899',
  TEAL_LIGHT: '#6EE7B7',
} as const

// ─── Column Color Presets ───────────────────────────────────────────────────
// Used in column-config-dialog for column color selection

export const COLUMN_COLOR_PRESETS = [
  ACCENT_COLORS.CORAL,    // accent
  STATUS_COLORS.SUCCESS,  // success
  ACCENT_COLORS.BLUE,     // running/blue
  STATUS_COLORS.WARNING,  // attention/amber
  STATUS_COLORS.ERROR,    // error/red
  ACCENT_COLORS.VIOLET,   // purple
  STATUS_COLORS.PINK,     // pink
  STATUS_COLORS.TEAL_LIGHT, // teal
] as const

// ─── Diff Viewer Colors ─────────────────────────────────────────────────────
// Used in diff-viewer for additions/deletions

export const DIFF_COLORS = {
  ADD: STATUS_COLORS.SUCCESS,
  REMOVE: STATUS_COLORS.ERROR,
} as const

// ─── Type exports ───────────────────────────────────────────────────────────

export type AccentColor = typeof ACCENT_COLORS[keyof typeof ACCENT_COLORS]
export type StatusColor = typeof STATUS_COLORS[keyof typeof STATUS_COLORS]
