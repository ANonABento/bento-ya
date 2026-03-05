// Column IPC commands

import { invoke, listen, type EventCallback, type UnlistenFn } from './core'
import type { Column } from '@/types'

// ─── Column commands ───────────────────────────────────────────────────────

export const getColumns = (workspaceId: string) =>
  invoke<Column[]>('list_columns', { workspaceId })
export const listColumns = getColumns

export async function createColumn(
  workspaceId: string,
  name: string,
  position: number,
): Promise<Column> {
  return invoke<Column>('create_column', { workspaceId, name, position })
}

export async function updateColumn(
  id: string,
  updates: {
    name?: string
    icon?: string
    position?: number
    color?: string | null
    visible?: boolean
    triggerConfig?: string
    exitConfig?: string
    autoAdvance?: boolean
  },
): Promise<Column> {
  // Map frontend field names to Rust snake_case
  return invoke<Column>('update_column', {
    id,
    name: updates.name,
    icon: updates.icon,
    position: updates.position,
    color: updates.color,
    visible: updates.visible,
    trigger_config: updates.triggerConfig,
    exit_config: updates.exitConfig,
    auto_advance: updates.autoAdvance,
  })
}

export async function reorderColumns(
  workspaceId: string,
  columnIds: string[],
): Promise<Column[]> {
  return invoke<Column[]>('reorder_columns', { workspaceId, columnIds })
}

export async function deleteColumn(id: string): Promise<void> {
  return invoke<void>('delete_column', { id })
}

// ─── Event listeners ───────────────────────────────────────────────────────

export const onColumnUpdated = (cb: EventCallback<Column>): Promise<UnlistenFn> =>
  listen<Column>('column_updated', cb)
