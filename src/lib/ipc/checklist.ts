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
  detectConfig?: string  // JSON-encoded detection config
}

export type TemplateCategory = {
  name: string
  icon: string
  items: TemplateItem[]
}

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
  return invoke('delete_workspace_checklist', { workspaceId })
}

export async function updateChecklistItemAutoDetect(
  itemId: string,
  autoDetected: boolean,
  checked: boolean,
): Promise<ChecklistItem> {
  return invoke<ChecklistItem>('update_checklist_item_auto_detect', { itemId, autoDetected, checked })
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
