/** Shared dependency parsing utilities. */

export type DepEntry = {
  task_id: string
  condition: string
  target_column?: string
  on_met?: { type: string; target?: string }
}

/** Parse a task's dependencies JSON string into typed entries. */
export function parseDeps(json: string | null | undefined): DepEntry[] {
  if (!json) return []
  try {
    const parsed: unknown = JSON.parse(json)
    if (Array.isArray(parsed)) return parsed as DepEntry[]
    return []
  } catch { return [] }
}
