import type { ModelCapability } from '@/hooks/use-model-capabilities'
import { Tooltip } from '@/components/shared/tooltip'
import { ModelSelector } from '@/components/shared/model-selector'
import { ThinkingSelector } from '@/components/shared/thinking-selector'
import { PermissionSelector } from '@/components/shared/permission-selector'
import type { PermissionMode } from '@/components/shared/permission-utils'
import type { ThinkingLevel } from '@/components/shared/thinking-utils'
import type { ChatInputConfig, ModelId } from './chat-input-types'

type ChatInputSettingsRowProps = {
  config: ChatInputConfig
  model: ModelId
  models: ModelCapability[]
  extendedContext: boolean
  supportsExtendedContext: boolean
  thinkingLevel: ThinkingLevel
  maxEffort: ThinkingLevel
  permissionMode: PermissionMode
  onModelChange: (modelId: ModelId) => void
  onContextToggle: () => void
  onThinkingChange: (level: ThinkingLevel) => void
  onPermissionChange: (mode: PermissionMode) => void
}

export function ChatInputSettingsRow({
  config,
  model,
  models,
  extendedContext,
  supportsExtendedContext,
  thinkingLevel,
  maxEffort,
  permissionMode,
  onModelChange,
  onContextToggle,
  onThinkingChange,
  onPermissionChange,
}: ChatInputSettingsRowProps) {
  return (
    <div className="mb-2 flex items-center gap-1">
      {config.showModelSelector && (
        <ModelSelector
          value={model}
          models={models}
          onChange={onModelChange}
        />
      )}

      {config.showContextToggle && supportsExtendedContext && (
        <Tooltip
          content={extendedContext ? 'Extended context enabled (1M tokens)' : 'Enable extended context (1M tokens)'}
          side="top"
          delay={300}
        >
          <button
            type="button"
            onClick={onContextToggle}
            className={`flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium transition-colors ${
              extendedContext
                ? 'bg-accent/15 text-accent'
                : 'text-text-muted hover:bg-surface-hover hover:text-text-secondary'
            }`}
          >
            1M
          </button>
        </Tooltip>
      )}

      {config.showThinkingSelector && (
        <ThinkingSelector
          value={thinkingLevel}
          maxLevel={maxEffort}
          onChange={onThinkingChange}
        />
      )}

      {config.showPermissionSelector && (
        <PermissionSelector value={permissionMode} onChange={onPermissionChange} />
      )}
    </div>
  )
}
