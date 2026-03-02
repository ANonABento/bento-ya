import { useState, useRef, useCallback } from 'react'
import { streamOrchestratorChat } from '@/lib/ipc'
import { useSettingsStore } from '@/stores/settings-store'

// Available models for the orchestrator (using CLI aliases)
const MODELS = [
  { id: 'sonnet', name: 'Sonnet', description: 'Fast & capable' },
  { id: 'opus', name: 'Opus', description: 'Most powerful' },
  { id: 'haiku', name: 'Haiku', description: 'Quick & light' },
] as const

type ModelId = typeof MODELS[number]['id']

type PanelInputProps = {
  workspaceId: string
  onMessageSent?: () => void
  disabled?: boolean
}

export function PanelInput({ workspaceId, onMessageSent, disabled = false }: PanelInputProps) {
  const [message, setMessage] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState<ModelId>(MODELS[0].id)
  const [showModelPicker, setShowModelPicker] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Get settings for LLM connection
  const settings = useSettingsStore((s) => s.global)
  const anthropicProvider = settings.model.providers.find((p) => p.id === 'anthropic')

  const handleSubmit = useCallback(async () => {
    if (!message.trim() || isProcessing || disabled) return

    setIsProcessing(true)
    setError(null)

    // Use connection mode from settings
    const connectionMode = anthropicProvider?.connectionMode ?? 'api'
    const apiKey = settings.agent.envVars['ANTHROPIC_API_KEY'] || undefined
    const cliPath = anthropicProvider?.cliPath || 'claude'

    try {
      await streamOrchestratorChat(
        workspaceId,
        message.trim(),
        connectionMode,
        apiKey,
        selectedModel,
        cliPath
      )
      setMessage('')
      onMessageSent?.()
    } catch (err) {
      const errorMessage = err instanceof Error
        ? err.message
        : typeof err === 'object' && err !== null
          ? JSON.stringify(err)
          : String(err)
      setError(`${connectionMode.toUpperCase()} error: ${errorMessage}`)
    } finally {
      setIsProcessing(false)
    }
  }, [message, workspaceId, isProcessing, disabled, onMessageSent, anthropicProvider, settings.agent.envVars, selectedModel])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Cmd+Enter or Ctrl+Enter to send
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        void handleSubmit()
      }
    },
    [handleSubmit]
  )

  // Auto-resize textarea
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value)
    setError(null)
    e.target.style.height = 'auto'
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`
  }

  const currentModel = MODELS.find(m => m.id === selectedModel) ?? MODELS[0]

  return (
    <div className="border-t border-border-default bg-surface p-3">
      {error && (
        <div className="mb-2 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-400">
          {error}
        </div>
      )}
      <div className="flex items-end gap-2">
        {/* Model selector */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowModelPicker(!showModelPicker)}
            disabled={isProcessing}
            className="flex h-[38px] items-center gap-1 rounded-lg border border-border-default bg-bg px-2 text-xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
              <path d="M8 1a.75.75 0 0 1 .75.75v6.5a.75.75 0 0 1-1.5 0v-6.5A.75.75 0 0 1 8 1ZM10.25 8a2.25 2.25 0 1 1-4.5 0 2.25 2.25 0 0 1 4.5 0ZM8 15a.75.75 0 0 0 .75-.75V12.5h1.5a.75.75 0 0 0 0-1.5h-4.5a.75.75 0 0 0 0 1.5h1.5v1.75A.75.75 0 0 0 8 15Z" />
            </svg>
            <span className="max-w-[60px] truncate">{currentModel.name}</span>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
              <path fillRule="evenodd" d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
            </svg>
          </button>
          
          {showModelPicker && (
            <div className="absolute bottom-full left-0 mb-1 w-48 rounded-lg border border-border-default bg-surface shadow-lg">
              {MODELS.map((model) => (
                <button
                  key={model.id}
                  type="button"
                  onClick={() => {
                    setSelectedModel(model.id)
                    setShowModelPicker(false)
                  }}
                  className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors hover:bg-surface-hover ${
                    model.id === selectedModel ? 'bg-surface-hover text-text-primary' : 'text-text-secondary'
                  }`}
                >
                  <div>
                    <div className="font-medium text-text-primary">{model.name}</div>
                    <div className="text-text-secondary/70">{model.description}</div>
                  </div>
                  {model.id === selectedModel && (
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4 text-accent">
                      <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <textarea
          ref={inputRef}
          value={message}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder="Ask me to create tasks... (⌘+Enter)"
          rows={1}
          disabled={disabled || isProcessing}
          className="flex-1 resize-none rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-50"
          style={{ minHeight: '38px', maxHeight: '120px' }}
        />
        
        <button
          type="button"
          onClick={() => { void handleSubmit() }}
          disabled={!message.trim() || isProcessing || disabled}
          className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg bg-accent text-bg transition-colors hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isProcessing ? (
            <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path d="M3.105 2.288a.75.75 0 0 0-.826.95l1.414 4.926A1.5 1.5 0 0 0 5.135 9.25h6.115a.75.75 0 0 1 0 1.5H5.135a1.5 1.5 0 0 0-1.442 1.086l-1.414 4.926a.75.75 0 0 0 .826.95 28.897 28.897 0 0 0 15.293-7.155.75.75 0 0 0 0-1.114A28.897 28.897 0 0 0 3.105 2.288Z" />
            </svg>
          )}
        </button>
      </div>
      
      {/* Connection mode indicator */}
      <div className="mt-2 flex items-center gap-2 text-xs text-text-secondary/70">
        <span className={`inline-block h-1.5 w-1.5 rounded-full ${anthropicProvider?.connectionMode === 'cli' ? 'bg-green-400' : 'bg-blue-400'}`} />
        {anthropicProvider?.connectionMode === 'cli' ? 'CLI' : 'API'} mode
      </div>
    </div>
  )
}
