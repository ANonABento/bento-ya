import { useState, useRef, useCallback, useEffect } from 'react'
import { useSettingsStore } from '@/stores/settings-store'
import { useVoiceInput } from '@/hooks/use-voice-input'
import { Tooltip } from '@/components/shared/tooltip'

// Available models for the orchestrator (using CLI aliases)
// Ordered by capability: Opus (most powerful) → Sonnet (balanced) → Haiku (fast)
const MODELS = [
  { id: 'opus', name: 'Opus', description: 'Most powerful' },
  { id: 'sonnet', name: 'Sonnet', description: 'Fast & capable' },
  { id: 'haiku', name: 'Haiku', description: 'Quick & light' },
] as const

type ModelId = typeof MODELS[number]['id']

export type SendMessageParams = {
  content: string
  model: ModelId
  connectionMode: 'api' | 'cli'
  apiKey?: string
  cliPath: string
}

type PanelInputProps = {
  onSendMessage: (params: SendMessageParams) => void
  onCancel?: () => void
  isProcessing?: boolean
  disabled?: boolean
  queueCount?: number
}

export function PanelInput({ onSendMessage, onCancel, isProcessing = false, disabled = false, queueCount = 0 }: PanelInputProps) {
  const [message, setMessage] = useState('')
  const [selectedModel, setSelectedModel] = useState<ModelId>(MODELS[0].id)
  const [showModelPicker, setShowModelPicker] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Voice input - append transcript to current message
  const handleTranscript = useCallback((text: string) => {
    setMessage((prev) => {
      const separator = prev.trim() ? ' ' : ''
      return prev + separator + text
    })
    // Focus the input after transcription
    inputRef.current?.focus()
  }, [])

  const voice = useVoiceInput(handleTranscript)

  // Get settings for LLM connection
  const settings = useSettingsStore((s) => s.global)
  const anthropicProvider = settings.model.providers.find((p) => p.id === 'anthropic')

  const handleSubmit = useCallback(() => {
    const trimmed = message.trim()
    // Don't block on isProcessing - parent will queue the message
    if (!trimmed || disabled) return

    // Get connection settings
    const connectionMode = (anthropicProvider?.connectionMode ?? 'api')
    const apiKey = settings.agent.envVars['ANTHROPIC_API_KEY'] || undefined
    const cliPath = anthropicProvider?.cliPath || 'claude'

    // Emit message immediately - parent handles queueing
    onSendMessage({
      content: trimmed,
      model: selectedModel,
      connectionMode,
      apiKey,
      cliPath,
    })

    // Clear input immediately for snappy feel
    setMessage('')
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
    }
  }, [message, disabled, onSendMessage, anthropicProvider, settings.agent.envVars, selectedModel])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        if (e.shiftKey) {
          // Shift+Enter: allow newline (default behavior)
          return
        }
        // Enter: send message
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit]
  )

  // Auto-resize textarea
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`
  }

  // Auto-resize when voice liveText changes
  useEffect(() => {
    if (voice.state === 'recording' && inputRef.current) {
      inputRef.current.style.height = 'auto'
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`
    }
  }, [voice.liveText, voice.state])

  const currentModel = MODELS.find(m => m.id === selectedModel) ?? MODELS[0]

  return (
    <div className="border-t border-border-default bg-surface p-3">
      <div className="flex items-end gap-2">
        {/* Model selector with connection mode */}
        <div className="relative">
          <button
            type="button"
            onClick={() => { setShowModelPicker(!showModelPicker); }}
            disabled={isProcessing}
            className="flex h-[38px] items-center gap-1.5 rounded-lg border border-border-default bg-bg px-2 text-xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
          >
            <span className={`h-1.5 w-1.5 rounded-full ${anthropicProvider?.connectionMode === 'cli' ? 'bg-green-400' : 'bg-blue-400'}`} />
            <span className="max-w-[60px] truncate">{currentModel.name}</span>
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
              <path fillRule="evenodd" d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
            </svg>
          </button>

          {showModelPicker && (
            <div className="absolute bottom-full left-0 mb-1 w-48 rounded-lg border border-border-default bg-surface shadow-lg overflow-hidden">
              {/* Connection mode indicator */}
              <div className="px-3 py-2 border-b border-border-default bg-bg/50">
                <div className="flex items-center gap-2 text-xs">
                  <span className={`h-1.5 w-1.5 rounded-full ${anthropicProvider?.connectionMode === 'cli' ? 'bg-green-400' : 'bg-blue-400'}`} />
                  <span className="text-text-secondary">
                    {anthropicProvider?.connectionMode === 'cli' ? 'CLI mode' : 'API mode'}
                  </span>
                </div>
              </div>
              {/* Model options */}
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
          value={voice.state === 'recording' ? voice.liveText : message}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={voice.state === 'recording' ? 'Listening...' : voice.state === 'processing' ? 'Transcribing...' : 'Ask me to create tasks...'}
          rows={1}
          readOnly={voice.state === 'recording'}
          disabled={disabled || voice.state === 'processing'}
          className={`flex-1 resize-none rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-50 ${voice.state === 'recording' ? 'italic text-text-secondary' : ''}`}
          style={{ minHeight: '38px', maxHeight: '120px' }}
        />

        {/* Voice input button - always show with helpful tooltip */}
        <Tooltip
          content={
            voice.state === 'recording'
              ? `Recording (${voice.duration}s) - click to stop`
              : voice.state === 'error'
                ? `Error: ${voice.error || 'Unknown error'}`
                : !voice.isEnabled
                  ? 'Enable voice in Settings → Voice'
                  : !voice.isApiAvailable
                    ? 'Download a model in Settings → Voice'
                    : 'Click to record voice'
          }
          side="top"
          delay={100}
        >
          <button
            type="button"
            onClick={() => {
              console.log('[Voice Button] Clicked!', {
                isAvailable: voice.isAvailable,
                isEnabled: voice.isEnabled,
                isApiAvailable: voice.isApiAvailable,
                state: voice.state,
                error: voice.error,
              })
              if (voice.state === 'recording') {
                console.log('[Voice Button] Stopping recording...')
                void voice.stopRecording()
              } else if (voice.state === 'idle' && voice.isAvailable) {
                console.log('[Voice Button] Starting recording...')
                void voice.startRecording()
              } else if (voice.state === 'error') {
                // Clear error state on click
                console.log('[Voice Button] Clearing error state...')
                void voice.startRecording()
              }
              // If not available, do nothing - tooltip will explain why
            }}
            disabled={disabled || isProcessing || voice.state === 'processing'}
            className={`flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg border transition-colors ${
              voice.state === 'recording'
                ? 'border-accent bg-accent/10 text-accent animate-pulse'
                : voice.state === 'processing'
                  ? 'border-accent bg-accent/10 text-accent'
                  : voice.state === 'error'
                    ? 'border-yellow-500 bg-yellow-500/10 text-yellow-500'
                    : !voice.isAvailable
                      ? 'border-border-default bg-bg text-text-secondary/40 cursor-help'
                      : 'border-border-default bg-bg text-text-primary hover:bg-bg-hover hover:border-border-hover'
            } disabled:opacity-50 disabled:cursor-not-allowed`}
          >
            {voice.state === 'processing' ? (
              <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
                <path d="M8 1a2 2 0 0 0-2 2v4a2 2 0 1 0 4 0V3a2 2 0 0 0-2-2Z" />
                <path d="M4.5 7A.75.75 0 0 0 3 7a5 5 0 0 0 4.25 4.944V13.5h-1.5a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 0-1.5h-1.5v-1.556A5 5 0 0 0 13 7a.75.75 0 0 0-1.5 0 3.5 3.5 0 1 1-7 0Z" />
              </svg>
            )}
          </button>
        </Tooltip>

        {/* Cancel button (only when processing) */}
        {isProcessing && (
          <Tooltip content={queueCount > 0 ? `Cancel (${queueCount} queued)` : 'Cancel'} side="top" delay={200}>
            <button
              type="button"
              onClick={onCancel}
              className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg bg-red-500/10 text-red-500 border border-red-500/30 transition-colors hover:bg-red-500/20"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4">
                <path fillRule="evenodd" d="M8 15A7 7 0 1 0 8 1a7 7 0 0 0 0 14Zm2.78-4.22a.75.75 0 0 1-1.06 0L8 9.06l-1.72 1.72a.75.75 0 1 1-1.06-1.06L6.94 8 5.22 6.28a.75.75 0 0 1 1.06-1.06L8 6.94l1.72-1.72a.75.75 0 1 1 1.06 1.06L9.06 8l1.72 1.72a.75.75 0 0 1 0 1.06Z" clipRule="evenodd" />
              </svg>
            </button>
          </Tooltip>
        )}

        {/* Send button (always visible, queues when processing) */}
        <Tooltip content={isProcessing ? 'Queue message' : 'Send'} side="top" delay={200}>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!message.trim() || disabled}
            className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg bg-accent text-bg transition-colors hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
              <path d="M3.105 2.288a.75.75 0 0 0-.826.95l1.414 4.926A1.5 1.5 0 0 0 5.135 9.25h6.115a.75.75 0 0 1 0 1.5H5.135a1.5 1.5 0 0 0-1.442 1.086l-1.414 4.926a.75.75 0 0 0 .826.95 28.897 28.897 0 0 0 15.293-7.155.75.75 0 0 0 0-1.114A28.897 28.897 0 0 0 3.105 2.288Z" />
            </svg>
          </button>
        </Tooltip>
      </div>
    </div>
  )
}
