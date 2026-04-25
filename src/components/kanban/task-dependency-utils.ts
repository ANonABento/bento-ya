import type { Dependency } from './task-dependency-parsers'

export function parseOverrides(json: string | null): Record<string, unknown> {
  if (!json) return {}
  try {
    return JSON.parse(json) as Record<string, unknown>
  } catch {
    return {}
  }
}

export function parseDependencies(json: string | null): Dependency[] {
  if (!json) return []
  try {
    return JSON.parse(json) as Dependency[]
  } catch {
    return []
  }
}
