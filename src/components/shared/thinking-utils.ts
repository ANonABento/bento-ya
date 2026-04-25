export type ThinkingLevel = 'none' | 'low' | 'medium' | 'high'

const THINKING_TO_EFFORT: Record<ThinkingLevel, string | undefined> = {
  none: undefined,
  low: 'low',
  medium: 'medium',
  high: 'high',
}

export function thinkingToEffort(level: ThinkingLevel): string | undefined {
  return THINKING_TO_EFFORT[level]
}
