/**
 * ModelSelector - Model selection with optional extended context toggle.
 * Uses shared SelectorDropdown for consistent styling.
 */

import { useState, useRef, useCallback } from 'react'
import { useSettingsStore } from '@/stores/settings-store'
import { SelectorDropdown, SelectorOption, SelectorButton } from './selector-dropdown'

const MODELS = [
  { id: 'opus', name: 'Opus', description: 'Most powerful' },
  { id: 'sonnet', name: 'Sonnet', description: 'Fast & capable' },
  { id: 'haiku', name: 'Haiku', description: 'Quick & light' },
] as const

export type ModelId = (typeof MODELS)[number]['id']

export type ModelSelection = {
  model: ModelId
  extendedContext: boolean
}

interface ModelSelectorProps {
  value?: ModelId
  extendedContext?: boolean
  showContextToggle?: boolean
  onChange?: (selection: ModelSelection) => void
}

export function ModelSelector({
  value = 'sonnet',
  extendedContext = false,
  showContextToggle = false,
  onChange,
}: ModelSelectorProps) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<ModelId>(value)
  const [extended, setExtended] = useState(extendedContext)
  const ref = useRef<HTMLDivElement>(null)

  const settings = useSettingsStore((s) => s.global)
  const anthropicProvider = settings.model.providers.find((p) => p.id === 'anthropic')
  const connectionMode = anthropicProvider?.connectionMode ?? 'cli'

  const handleSelect = useCallback((modelId: ModelId) => {
    setSelected(modelId)
    onChange?.({ model: modelId, extendedContext: extended })
    setOpen(false)
  }, [extended, onChange])

  const handleContextToggle = useCallback(() => {
    const newExtended = !extended
    setExtended(newExtended)
    onChange?.({ model: selected, extendedContext: newExtended })
  }, [extended, selected, onChange])

  const currentModel = MODELS.find((m) => m.id === selected) ?? MODELS[1]

  const header = (
    <div className="flex items-center gap-1.5">
      <span className={`h-1.5 w-1.5 rounded-full ${connectionMode === 'cli' ? 'bg-green-400' : 'bg-blue-400'}`} />
      <span>{connectionMode === 'cli' ? 'CLI mode' : 'API mode'}</span>
    </div>
  )

  return (
    <div ref={ref} className="relative flex items-center gap-1">
      <SelectorButton onClick={() => { setOpen(!open) }} open={open}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" className="opacity-70">
          <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1" fill="none" />
          <circle cx="6" cy="6" r="2" fill="currentColor" />
        </svg>
        <span className={`h-1.5 w-1.5 rounded-full ${connectionMode === 'cli' ? 'bg-green-400' : 'bg-blue-400'}`} />
        {currentModel.name}
      </SelectorButton>

      {/* Extended context toggle button */}
      {showContextToggle && (
        <button
          type="button"
          onClick={handleContextToggle}
          className={`flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium transition-colors ${
            extended
              ? 'bg-accent/15 text-accent'
              : 'text-text-muted hover:bg-surface-hover hover:text-text-secondary'
          }`}
          title={extended ? 'Extended context enabled (1M tokens)' : 'Click to enable extended context (1M tokens)'}
        >
          1M
        </button>
      )}

      <SelectorDropdown
        open={open}
        onClose={() => { setOpen(false) }}
        header={header}
      >
        {MODELS.map((model) => (
          <SelectorOption
            key={model.id}
            selected={model.id === selected}
            onClick={() => { handleSelect(model.id) }}
            label={model.name}
            description={model.description}
          />
        ))}
      </SelectorDropdown>
    </div>
  )
}
