/**
 * ModelSelector - Simple model picker (fully controlled).
 * Parent owns selected state. No internal duplication.
 */

import { useState, useCallback } from 'react'
import { useSettingsStore } from '@/stores/settings-store'
import { SelectorDropdown, SelectorOption, SelectorButton } from './selector-dropdown'
import type { ModelCapability } from '@/hooks/use-model-capabilities'

export type ModelId = 'opus' | 'sonnet' | 'haiku'

const FALLBACK_MODELS: ModelCapability[] = [
  { id: 'opus', name: 'Opus', description: 'Most powerful', supportsExtendedContext: true, contextWindow: '200k', maxEffort: 'high', available: true },
  { id: 'sonnet', name: 'Sonnet', description: 'Fast & capable', supportsExtendedContext: false, contextWindow: '200k', maxEffort: 'high', available: true },
  { id: 'haiku', name: 'Haiku', description: 'Quick & light', supportsExtendedContext: false, contextWindow: '200k', maxEffort: 'low', available: true },
]

interface ModelSelectorProps {
  value: ModelId
  /** Model capabilities from useModelCapabilities hook */
  models?: ModelCapability[]
  onChange: (modelId: ModelId) => void
}

export function ModelSelector({
  value,
  models,
  onChange,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false)

  const settings = useSettingsStore((s) => s.global)
  const anthropicProvider = settings.model.providers.find((p) => p.id === 'anthropic')
  const connectionMode = anthropicProvider?.connectionMode ?? 'cli'

  const modelList = models ?? FALLBACK_MODELS
  const currentModel = modelList.find((m) => m.id === value) ?? modelList[1]

  const handleSelect = useCallback((modelId: ModelId) => {
    onChange(modelId)
    setOpen(false)
  }, [onChange])

  const header = (
    <div className="flex items-center gap-1.5">
      <span className={`h-1.5 w-1.5 rounded-full ${connectionMode === 'cli' ? 'bg-green-400' : 'bg-blue-400'}`} />
      <span>{connectionMode === 'cli' ? 'CLI mode' : 'API mode'}</span>
    </div>
  )

  return (
    <div className="relative">
      <SelectorButton onClick={() => { setOpen(!open) }} open={open}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" className="opacity-70">
          <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1" fill="none" />
          <circle cx="6" cy="6" r="2" fill="currentColor" />
        </svg>
        <span className={`h-1.5 w-1.5 rounded-full ${connectionMode === 'cli' ? 'bg-green-400' : 'bg-blue-400'}`} />
        {currentModel?.name ?? 'Sonnet'}
      </SelectorButton>

      <SelectorDropdown
        open={open}
        onClose={() => { setOpen(false) }}
        header={header}
        width="w-48"
      >
        {modelList.map((model) => (
          <SelectorOption
            key={model.id}
            selected={model.id === value}
            onClick={() => { handleSelect(model.id as ModelId) }}
            label={model.name}
            description={model.description}
          />
        ))}
      </SelectorDropdown>
    </div>
  )
}
