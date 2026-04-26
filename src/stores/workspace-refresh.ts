import { useWorkspaceStore } from './workspace-store'

export async function refreshWorkspaceSummary(
  workspaceId: string | null | undefined,
): Promise<void> {
  if (!workspaceId) return

  try {
    await useWorkspaceStore.getState().refreshWorkspace(workspaceId)
  } catch {
    // Refresh is best-effort; the primary board operation has already succeeded.
  }
}
