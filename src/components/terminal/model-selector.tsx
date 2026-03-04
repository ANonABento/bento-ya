import { useState, useRef, useEffect } from 'react'
import { useSettingsStore } from '@/stores/settings-store'

// Default models for CLI mode (alias-based)
const CLI_MODELS = [
  { id: 'opus', name: 'Opus', description: 'Most powerful' },
  { id: 'sonnet', name: 'Sonnet', description: 'Fast & capable' },
  { id: 'haiku', name: 'Haiku', description: 'Quick & light' },
] as const

export type ModelId = string

interface ModelSelectorProps {
  value?: ModelId
  onChange?: (modelId: ModelId) => void
}

export function ModelSelector({ value, onChange }: ModelSelectorProps) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<ModelId>(value ?? 'sonnet')
  const ref = useRef<HTMLDivElement>(null)

  const settings = useSettingsStore((s) => s.global)
  const anthropicProvider = settings.model.providers.find((p) => p.id === 'anthropic')
  const connectionMode = anthropicProvider?.connectionMode ?? 'cli'

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => { document.removeEventListener('mousedown', handleClickOutside) }
  }, [])

  const handleSelect = (modelId: ModelId) => {
    setSelected(modelId)
    onChange?.(modelId)
    setOpen(false)
  }

  const currentModel = CLI_MODELS.find((m) => m.id === selected) ?? CLI_MODELS[1]

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => { setOpen(!open) }}
        className="flex items-center gap-1 rounded px-2 py-1 text-xs text-text-secondary hover:bg-bg-tertiary hover:text-text-primary"
      >
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" className="opacity-70">
          <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1" fill="none" />
          <circle cx="6" cy="6" r="2" fill="currentColor" />
        </svg>
        <span className={`h-1.5 w-1.5 rounded-full ${connectionMode === 'cli' ? 'bg-green-400' : 'bg-blue-400'}`} />
        {currentModel.name}
        <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
          <path d="M2.5 4L5 6.5L7.5 4" stroke="currentColor" strokeWidth="1.2" fill="none" />
        </svg>
      </button>

      {open && (
        <div className="absolute bottom-full left-0 mb-1 w-44 rounded border border-border-default bg-bg-secondary py-1 shadow-lg">
          {/* Connection mode indicator */}
          <div className="px-3 py-1.5 border-b border-border-default text-[10px] text-text-muted">
            <span className={`inline-block h-1.5 w-1.5 rounded-full mr-1 ${connectionMode === 'cli' ? 'bg-green-400' : 'bg-blue-400'}`} />
            {connectionMode === 'cli' ? 'CLI mode' : 'API mode'}
          </div>
          {/* Model options */}
          {CLI_MODELS.map((model) => (
            <button
              key={model.id}
              type="button"
              onClick={() => { handleSelect(model.id) }}
              className={`block w-full px-3 py-1.5 text-left text-xs hover:bg-bg-tertiary ${
                model.id === selected ? 'text-accent' : 'text-text-secondary'
              }`}
            >
              <div className="font-medium">{model.name}</div>
              <div className="text-text-muted text-[10px]">{model.description}</div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
