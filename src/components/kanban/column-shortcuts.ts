import type { Column } from '@/types'

export const MAX_COLUMN_SHORTCUTS = 6

export function shouldEnableColumnShortcuts(columnCount: number) {
  return columnCount <= MAX_COLUMN_SHORTCUTS
}

export function getColumnShortcutIndex(key: string, columnCount: number) {
  if (!shouldEnableColumnShortcuts(columnCount)) return null
  if (key < '1' || key > '9') return null

  const index = Number.parseInt(key, 10) - 1
  return index >= 0 && index < columnCount ? index : null
}

export function getVisibleColumnsForShortcuts(columns: Column[]) {
  return columns
    .filter((column) => column.visible)
    .sort((a, b) => a.position - b.position)
}
