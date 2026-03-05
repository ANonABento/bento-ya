// Checklist IPC commands

import { invoke } from './core'

// ─── Types ─────────────────────────────────────────────────────────────────

export type ChecklistItem = {
  id: string
  categoryId: string
  text: string
  checked: boolean
  notes: string | null
  position: number
  createdAt: string
  updatedAt: string
}

export type ChecklistCategory = {
  id: string
  checklistId: string
  name: string
  icon: string
  position: number
  progress: number
  totalItems: number
  collapsed: boolean
}

export type ChecklistData = {
  id: string
  workspaceId: string
  name: string
  description: string | null
  progress: number
  totalItems: number
  createdAt: string
  updatedAt: string
}

export type ChecklistWithData = {
  checklist: ChecklistData | null
  categories: ChecklistCategory[]
  items: Record<string, ChecklistItem[]>
}

export type TemplateItem = {
  text: string
}

export type TemplateCategory = {
  name: string
  icon: string
  items: TemplateItem[]
}

// ─── Checklist commands ──────────────────────────────────────────────────────

export async function getWorkspaceChecklist(workspaceId: string): Promise<ChecklistWithData> {
  return invoke<ChecklistWithData>('get_workspace_checklist', { workspaceId })
}

export async function updateChecklistItem(
  itemId: string,
  checked?: boolean,
  notes?: string | null,
): Promise<ChecklistItem> {
  return invoke<ChecklistItem>('update_checklist_item', { itemId, checked, notes })
}

export async function updateChecklistCategory(
  categoryId: string,
  collapsed: boolean,
): Promise<ChecklistCategory> {
  return invoke<ChecklistCategory>('update_checklist_category', { categoryId, collapsed })
}

export async function createWorkspaceChecklist(
  workspaceId: string,
  name: string,
  description: string | null,
  categories: TemplateCategory[],
): Promise<ChecklistWithData> {
  return invoke<ChecklistWithData>('create_workspace_checklist', {
    workspaceId,
    name,
    description,
    categories,
  })
}

export async function deleteWorkspaceChecklist(workspaceId: string): Promise<void> {
  return invoke<void>('delete_workspace_checklist', { workspaceId })
}
