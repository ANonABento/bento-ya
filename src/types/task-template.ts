export type TaskTemplate = {
  id: string
  workspaceId: string
  title: string
  description: string | null
  labels: string
  model: string | null
  createdAt: string
  updatedAt: string
}
