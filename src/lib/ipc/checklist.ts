import { invoke } from './invoke'

// ─── Checklist commands ──────────────────────────────────────────────────────

export type ChecklistItem = {
  id: string
  categoryId: string
  text: string
  checked: boolean
  notes: string | null
  position: number
  // Auto-detect fields
  detectType: string | null
  detectConfig: string | null
  autoDetected: boolean
  linkedTaskId: string | null
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
  detectType?: string
  detectConfig?: string // JSON-encoded detection config
}

export type TemplateCategory = {
  name: string
  icon: string
  items: TemplateItem[]
}

export type UpdateChecklistItemInput = {
  text?: string
  checked?: boolean
  notes?: string | null
  position?: number
  detectType?: string | null
  detectConfig?: string | null
  autoDetected?: boolean
  linkedTaskId?: string | null
}

export type UpdateChecklistCategoryInput = {
  name?: string
  icon?: string
  position?: number
}

export async function createChecklist(
  workspaceId: string,
  name: string,
  description?: string | null,
): Promise<ChecklistData> {
  return invoke<ChecklistData>('create_checklist', { workspaceId, name, description })
}

export async function updateChecklist(
  checklistId: string,
  updates: { name?: string; description?: string | null },
): Promise<ChecklistData> {
  return invoke<ChecklistData>('update_checklist', { checklistId, ...updates })
}

export async function deleteChecklist(checklistId: string): Promise<void> {
  return invoke('delete_checklist', { checklistId })
}

export async function getWorkspaceChecklist(workspaceId: string): Promise<ChecklistWithData> {
  return invoke<ChecklistWithData>('get_workspace_checklist', { workspaceId })
}

export async function updateChecklistItem(
  itemId: string,
  updates: UpdateChecklistItemInput = {},
): Promise<ChecklistItem> {
  return invoke<ChecklistItem>('update_checklist_item', { itemId, updates })
}

export async function createChecklistCategory(
  checklistId: string,
  name: string,
  icon: string,
  position?: number,
): Promise<ChecklistCategory> {
  return invoke<ChecklistCategory>('create_checklist_category', {
    checklistId,
    name,
    icon,
    position,
  })
}

export async function updateChecklistCategory(
  categoryId: string,
  collapsed?: boolean,
  updates: UpdateChecklistCategoryInput = {},
): Promise<ChecklistCategory> {
  return invoke<ChecklistCategory>('update_checklist_category', {
    categoryId,
    collapsed,
    ...updates,
  })
}

export async function deleteChecklistCategory(categoryId: string): Promise<void> {
  return invoke('delete_checklist_category', { categoryId })
}

export async function createChecklistItem(
  categoryId: string,
  text: string,
  position?: number,
  detectType?: string,
  detectConfig?: string,
): Promise<ChecklistItem> {
  return invoke<ChecklistItem>('create_checklist_item', {
    categoryId,
    text,
    position,
    detectType,
    detectConfig,
  })
}

export async function deleteChecklistItem(itemId: string): Promise<void> {
  return invoke('delete_checklist_item', { itemId })
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
  return invoke('delete_workspace_checklist', { workspaceId })
}

export async function updateChecklistItemAutoDetect(
  itemId: string,
  autoDetected: boolean,
  checked: boolean,
): Promise<ChecklistItem> {
  return invoke<ChecklistItem>('update_checklist_item_auto_detect', {
    itemId,
    autoDetected,
    checked,
  })
}

export async function linkChecklistItemToTask(
  itemId: string,
  taskId: string | null,
): Promise<ChecklistItem> {
  return invoke<ChecklistItem>('link_checklist_item_to_task', { itemId, taskId })
}

export type DetectionResult = {
  itemId: string
  detected: boolean
  message: string | null
}

export async function runChecklistDetection(
  workspaceId: string,
  repoPath: string,
): Promise<DetectionResult[]> {
  return invoke<DetectionResult[]>('run_checklist_detection', { workspaceId, repoPath })
}
