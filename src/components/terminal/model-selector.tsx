interface ModelSelectorProps {
  modelName?: string
}

export function ModelSelector({ modelName = 'Claude' }: ModelSelectorProps) {
  return (
    <div className="flex items-center gap-1 rounded px-2 py-1 text-xs text-text-muted">
      <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" className="opacity-50">
        <circle cx="6" cy="6" r="5" stroke="currentColor" strokeWidth="1" fill="none" />
        <circle cx="6" cy="6" r="2" fill="currentColor" />
      </svg>
      {modelName}
    </div>
  )
}
