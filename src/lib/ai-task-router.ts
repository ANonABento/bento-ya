import { canonicalModelId, canonicalModelUsageKey } from '@/lib/model-metadata'
import type { Settings } from '@/types/settings'

export type KaitenCodeTaskId =
  | 'kaitencode.column_trigger_generation'
  | 'kaitencode.orchestrator_chat'
  | 'kaitencode.agent_task_input'

export type KaitenCodeTaskPolicy = {
  taskId: KaitenCodeTaskId
  providerId: string
  model: string
  fallbackModels: string[]
  maxRetries: number
  timeoutMs: number
  maxRequestCostUsd: number | null
  budgetKey: string
}

const DEFAULT_TASK_MODELS: Record<KaitenCodeTaskId, string> = {
  'kaitencode.column_trigger_generation': 'haiku',
  'kaitencode.orchestrator_chat': 'sonnet',
  'kaitencode.agent_task_input': 'sonnet',
}

const DEFAULT_FALLBACKS: Record<KaitenCodeTaskId, string[]> = {
  'kaitencode.column_trigger_generation': ['sonnet'],
  'kaitencode.orchestrator_chat': ['haiku'],
  'kaitencode.agent_task_input': ['haiku'],
}

export function resolveKaitenCodeTaskPolicy(
  settings: Settings,
  taskId: KaitenCodeTaskId,
  requestedModel?: string,
): KaitenCodeTaskPolicy {
  const provider = settings.model.providers.find((candidate) => candidate.enabled)
    ?? settings.model.providers[0]

  if (!provider) {
    throw new Error('No AI provider configured')
  }

  const preferredModel = requestedModel
    || DEFAULT_TASK_MODELS[taskId]
    || provider.defaultModel
  const model = canonicalModelId(preferredModel, provider.id)
  const fallbackModels = DEFAULT_FALLBACKS[taskId]
    .map((fallback) => canonicalModelId(fallback, provider.id))
    .filter((fallback) => fallback !== model)

  return {
    taskId,
    providerId: provider.id,
    model,
    fallbackModels,
    maxRetries: 1,
    timeoutMs: settings.advanced.messageTimeoutSeconds * 1000,
    maxRequestCostUsd: settings.model.dailyBudgetsUsd[canonicalModelUsageKey(model, provider.id)] ?? null,
    budgetKey: canonicalModelUsageKey(model, provider.id),
  }
}
