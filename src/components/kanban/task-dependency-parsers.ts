export type Dependency = {
  task_id: string
  condition: string
  target_column?: string
  on_met: { type: string; target?: string }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function parseDependency(value: unknown): Dependency | null {
  if (!isRecord(value)) return null

  const taskId = value.task_id
  const condition = value.condition
  const onMet = value.on_met
  if (typeof taskId !== 'string' || typeof condition !== 'string' || !isRecord(onMet)) {
    return null
  }

  const actionType = onMet.type
  if (typeof actionType !== 'string') return null

  return {
    task_id: taskId,
    condition,
    target_column: toOptionalString(value.target_column),
    on_met: {
      type: actionType,
      target: toOptionalString(onMet.target),
    },
  }
}

export function parseOverrides(json: string | null): Record<string, unknown> {
  if (!json) return {}
  try {
    const parsed: unknown = JSON.parse(json)
    return isRecord(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function parseDependencies(json: string | null): Dependency[] {
  if (!json) return []
  try {
    const parsed: unknown = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => {
      const dep = parseDependency(item)
      return dep ? [dep] : []
    })
  } catch {
    return []
  }
}
