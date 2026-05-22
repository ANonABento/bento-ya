/**
 * ModelSelector - Simple model picker (fully controlled).
 * Parent owns selected state. No internal duplication.
 */

import { useState, useCallback } from 'react'
import { SelectorDropdown, SelectorOption, SelectorButton } from './selector-dropdown'
import { useModelCapabilities, type ModelCapability } from '@/hooks/use-model-capabilities'

export type ModelId = string

interface ModelSelectorProps {
  value: ModelId
  /** Model capabilities from useModelCapabilities hook (optional — fetches dynamically if not provided) */
  models?: ModelCapability[]
  onChange: (modelId: ModelId) => void
}

export function ModelSelector({
  value,
  models: modelsProp,
  onChange,
}: ModelSelectorProps) {
  const { models: dynamicModels } = useModelCapabilities()
  const models = modelsProp ?? dynamicModels
  const [open, setOpen] = useState(false)

  const currentModel = models.find((m) =>
    m.id === value || m.fullId === value || m.aliases?.includes(value)
  ) ?? models[1]

  const handleSelect = useCallback((modelId: ModelId) => {
    onChange(modelId)
    setOpen(false)
  }, [onChange])

  return (
    <div className="relative">
      <SelectorButton onClick={() => { setOpen(!open) }} open={open}>
        {currentModel?.name ?? 'Sonnet'}
      </SelectorButton>

      <SelectorDropdown
        open={open}
        onClose={() => { setOpen(false) }}
        width="w-56"
      >
        {models.map((model) => (
          <SelectorOption
            key={model.id}
            selected={model.id === value}
            onClick={() => { handleSelect(model.id) }}
            label={model.name}
            description={model.description}
          />
        ))}
      </SelectorDropdown>
    </div>
  )
}
