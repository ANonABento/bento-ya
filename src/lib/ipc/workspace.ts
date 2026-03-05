// Workspace IPC commands

import { invoke, listen, type EventCallback, type UnlistenFn } from './core'
import type { Workspace } from '@/types'

// ─── Workspace commands ────────────────────────────────────────────────────

export const getWorkspaces = () => invoke<Workspace[]>('list_workspaces')
export const listWorkspaces = getWorkspaces

export async function createWorkspace(name: string, repoPath: string): Promise<Workspace> {
  return invoke<Workspace>('create_workspace', { name, repoPath })
}

export async function getWorkspace(id: string): Promise<Workspace> {
  return invoke<Workspace>('get_workspace', { id })
}

export async function updateWorkspace(
  id: string,
  updates: Partial<Workspace>,
): Promise<Workspace> {
  return invoke<Workspace>('update_workspace', { id, ...updates })
}

export async function deleteWorkspace(id: string): Promise<void> {
  return invoke<void>('delete_workspace', { id })
}

export async function cloneWorkspace(sourceId: string, newName: string): Promise<Workspace> {
  return invoke<Workspace>('clone_workspace', { sourceId, newName })
}

export const reorderWorkspaces = (ids: string[]) =>
  invoke<void>('reorder_workspaces', { ids })

export async function updateWorkspaceConfig(
  id: string,
  config: string,
): Promise<Workspace> {
  return invoke<Workspace>('update_workspace', { id, config })
}

export const seedDemoData = (repoPath: string) =>
  invoke<Workspace>('seed_demo_data', { repoPath })

// ─── Event listeners ───────────────────────────────────────────────────────

export const onWorkspaceUpdated = (cb: EventCallback<Workspace>): Promise<UnlistenFn> =>
  listen<Workspace>('workspace_updated', cb)
