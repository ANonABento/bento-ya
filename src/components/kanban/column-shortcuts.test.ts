import { describe, expect, it } from 'vitest'
import type { Column } from '@/types'
import {
  getColumnShortcutIndex,
  getVisibleColumnsForShortcuts,
  MAX_COLUMN_SHORTCUTS,
  shouldEnableColumnShortcuts,
} from './column-shortcuts'

const createMockColumn = (overrides: Partial<Column> = {}): Column => ({
  id: 'col-1',
  workspaceId: 'ws-1',
  name: 'Test Column',
  icon: 'list',
  position: 0,
  color: '#E8A87C',
  visible: true,
  triggers: undefined,
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
  ...overrides,
})

describe('column shortcuts', () => {
  it('enables shortcuts only when the visible column count fits the hint UI', () => {
    expect(shouldEnableColumnShortcuts(MAX_COLUMN_SHORTCUTS)).toBe(true)
    expect(shouldEnableColumnShortcuts(MAX_COLUMN_SHORTCUTS + 1)).toBe(false)
  })

  it('maps number keys to zero-based visible column indices', () => {
    expect(getColumnShortcutIndex('1', 3)).toBe(0)
    expect(getColumnShortcutIndex('3', 3)).toBe(2)
  })

  it('ignores keys outside the visible column range', () => {
    expect(getColumnShortcutIndex('0', 3)).toBeNull()
    expect(getColumnShortcutIndex('4', 3)).toBeNull()
    expect(getColumnShortcutIndex('x', 3)).toBeNull()
  })

  it('disables numeric shortcuts when hints are hidden', () => {
    expect(getColumnShortcutIndex('1', MAX_COLUMN_SHORTCUTS + 1)).toBeNull()
  })

  it('sorts visible columns by position and filters hidden ones', () => {
    const columns = [
      createMockColumn({ id: 'col-3', position: 2 }),
      createMockColumn({ id: 'col-1', position: 0 }),
      createMockColumn({ id: 'col-2', position: 1, visible: false }),
    ]

    expect(getVisibleColumnsForShortcuts(columns).map((column) => column.id)).toEqual(['col-1', 'col-3'])
  })
})
