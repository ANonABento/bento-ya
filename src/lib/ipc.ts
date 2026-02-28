import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type { Workspace, Column, Task } from '@/types'

// Workspace commands
export const getWorkspaces = () => invoke<Workspace[]>('get_workspaces')
export const createWorkspace = (name: string, repoPath: string) =>
  invoke<Workspace>('create_workspace', { name, repoPath })
export const updateWorkspace = (id: string, updates: Partial<Workspace>) =>
  invoke<Workspace>('update_workspace', { id, ...updates })
export const deleteWorkspace = (id: string) =>
  invoke<void>('delete_workspace', { id })
export const reorderWorkspaces = (ids: string[]) =>
  invoke<void>('reorder_workspaces', { ids })

// Column commands
export const getColumns = (workspaceId: string) =>
  invoke<Column[]>('get_columns', { workspaceId })
export const createColumn = (workspaceId: string, name: string, position: number) =>
  invoke<Column>('create_column', { workspaceId, name, position })
export const updateColumn = (id: string, updates: Partial<Column>) =>
  invoke<Column>('update_column', { id, ...updates })
export const deleteColumn = (id: string) =>
  invoke<void>('delete_column', { id })
export const reorderColumns = (workspaceId: string, ids: string[]) =>
  invoke<void>('reorder_columns', { workspaceId, ids })

// Task commands
export const getTasks = (workspaceId: string) =>
  invoke<Task[]>('get_tasks', { workspaceId })
export const createTask = (
  workspaceId: string,
  columnId: string,
  title: string,
  description: string,
) => invoke<Task>('create_task', { workspaceId, columnId, title, description })
export const updateTask = (id: string, updates: Partial<Task>) =>
  invoke<Task>('update_task', { id, ...updates })
export const deleteTask = (id: string) =>
  invoke<void>('delete_task', { id })
export const moveTask = (id: string, targetColumnId: string, position: number) =>
  invoke<void>('move_task', { id, targetColumnId, position })
export const reorderTasks = (columnId: string, ids: string[]) =>
  invoke<void>('reorder_tasks', { columnId, ids })

// Event listeners
export type EventCallback<T> = (payload: T) => void

export const onTaskUpdated = (cb: EventCallback<Task>): Promise<UnlistenFn> =>
  listen<Task>('task_updated', (e) => cb(e.payload))
export const onColumnUpdated = (cb: EventCallback<Column>): Promise<UnlistenFn> =>
  listen<Column>('column_updated', (e) => cb(e.payload))
export const onWorkspaceUpdated = (cb: EventCallback<Workspace>): Promise<UnlistenFn> =>
  listen<Workspace>('workspace_updated', (e) => cb(e.payload))
