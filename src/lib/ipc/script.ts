import { invoke } from './invoke'
import type { Script } from '@/types'

// ─── Script commands ──────────────────────────────────────────────────────

export const listScripts = () =>
  invoke<Script[]>('list_scripts')

export const getScript = (id: string) =>
  invoke<Script>('get_script', { id })

export const createScript = (name: string, description: string, steps: string) =>
  invoke<Script>('create_script', { name, description, steps })

export const updateScript = (
  id: string,
  updates: { name?: string; description?: string; steps?: string },
) =>
  invoke<Script>('update_script', { id, ...updates })

export const deleteScript = (id: string) =>
  invoke<void>('delete_script', { id })
