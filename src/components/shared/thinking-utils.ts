export const THINKING_LEVELS = [
  { id: 'none', label: 'None', description: 'No extended thinking', cliValue: undefined },
  { id: 'low', label: 'Low', description: 'Brief reasoning', cliValue: 'low' },
  { id: 'medium', label: 'Medium', description: 'Moderate depth', cliValue: 'medium' },
  { id: 'high', label: 'High', description: 'Deep analysis', cliValue: 'high' },
] as const

export const LEVEL_ORDER = ['none', 'low', 'medium', 'high'] as const

export type ThinkingLevel = (typeof THINKING_LEVELS)[number]['id']

export function toThinkingLevel(value: string | null | undefined, fallback: ThinkingLevel = 'high'): ThinkingLevel {
  return LEVEL_ORDER.includes(value as ThinkingLevel) ? (value as ThinkingLevel) : fallback
}

/** Map thinking level to CLI --effort value. */
export function thinkingToEffort(level: ThinkingLevel): string | undefined {
  return THINKING_LEVELS.find((l) => l.id === level)?.cliValue
}
