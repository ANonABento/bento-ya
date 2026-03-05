import { useState, useRef, useCallback, useEffect } from 'react'
import { useSettingsStore } from '@/stores/settings-store'
import { useVoiceInput } from '@/hooks/use-voice-input'
import { Tooltip } from '@/components/shared/tooltip'

// Available models for CLI (using CLI aliases)
const DEFAULT_MODELS = [
  { id: 'sonnet', name: 'Sonnet', description: 'Fast & capable' },
  { id: 'opus', name: 'Opus', description: 'Most powerful' },
  { id: 'haiku', name: 'Haiku', description: 'Quick & light' },
] as const

// Effort levels for reasoning depth
// Claude: CLAUDE_CODE_EFFORT_LEVEL (low/medium/high)
// OpenAI Codex: model_reasoning_effort (minimal/low/medium/high/xhigh)
const EFFORT_LEVELS = [
  { id: 'default', label: 'Auto', description: 'Model decides thinking depth' },
  { id: 'minimal', label: 'Min', description: 'Fastest, skip reasoning' },
  { id: 'low', label: 'Low', description: 'Brief reasoning' },
  { id: 'medium', label: 'Med', description: 'Balanced (recommended)' },
  { id: 'high', label: 'High', description: 'Deep analysis' },
  { id: 'xhigh', label: 'Max', description: 'Maximum thinking (Codex only)' },
] as const

export type EffortLevel = (typeof EFFORT_LEVELS)[number]['id']

export type ModelOption = {
  id: string
  name: string
  description: string
}

export type SendMessageParams = {
  content: string
  model: string
  effortLevel: EffortLevel
  connectionMode: 'api' | 'cli'
  apiKey?: string
  cliPath: string
}

type CliChatInputProps = {
  onSendMessage: (params: SendMessageParams) => void
  onCancel?: () => void
  isProcessing?: boolean
  disabled?: boolean
  queueCount?: number
  placeholder?: string
  models?: ModelOption[]
  showModelPicker?: boolean
  showThinkingPicker?: boolean
  showVoiceInput?: boolean
}

export function CliChatInput({
  onSendMessage,
  onCancel,
  isProcessing = false,
  disabled = false,
  queueCount = 0,
  placeholder = 'Type a message...',
  models = DEFAULT_MODELS as unknown as ModelOption[],
  showModelPicker: showModelPickerProp = true,
  showThinkingPicker: showThinkingPickerProp = true,
  showVoiceInput = true,
}: CliChatInputProps) {
  const [message, setMessage] = useState('')
  const [selectedModel, setSelectedModel] = useState(models[0]?.id ?? 'sonnet')
  const [selectedEffort, setSelectedEffort] = useState<EffortLevel>('default')
  const [showModelPicker, setShowModelPicker] = useState(false)
  const [showEffortPicker, setShowEffortPicker] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const effortPickerRef = useRef<HTMLDivElement>(null)

  // Voice input - append transcript to current message
  const handleTranscript = useCallback((text: string) => {
    setMessage((prev) => {
      const separator = prev.trim() ? ' ' : ''
      return prev + separator + text
    })
    inputRef.current?.focus()
  }, [])

  const voice = useVoiceInput(handleTranscript)

  // Get settings for LLM connection
  const settings = useSettingsStore((s) => s.global)
  const anthropicProvider = settings.model.providers.find((p) => p.id === 'anthropic')

  // Close effort picker when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (effortPickerRef.current && !effortPickerRef.current.contains(e.target as Node)) {
        setShowEffortPicker(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => { document.removeEventListener('mousedown', handleClickOutside); }
  }, [])

  const handleSubmit = useCallback(() => {
    const trimmed = message.trim()
    if (!trimmed || disabled) return

    const connectionMode = (anthropicProvider?.connectionMode ?? 'api')
    const apiKey = settings.agent.envVars['ANTHROPIC_API_KEY'] || undefined
    const cliPath = anthropicProvider?.cliPath || 'claude'

    onSendMessage({
      content: trimmed,
      model: selectedModel,
      effortLevel: selectedEffort,
      connectionMode,
      apiKey,
      cliPath,
    })

    setMessage('')
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
    }
  }, [message, disabled, onSendMessage, anthropicProvider, settings.agent.envVars, selectedModel, selectedEffort])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        if (e.shiftKey) return
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit]
  )

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = `${Math.min(e.target.scrollHeight, 120)}px`
  }

  useEffect(() => {
    if (voice.state === 'recording' && inputRef.current) {
      inputRef.current.style.height = 'auto'
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`
    }
  }, [voice.liveText, voice.state])

  const currentModel = models.find(m => m.id === selectedModel) ?? models[0]

  const getPlaceholder = () => {
    if (voice.state === 'recording') return 'Listening...'
    if (voice.state === 'processing') return 'Transcribing...'
    return placeholder
  }

  return (
    <div className="border-t border-border-default bg-surface p-3">
      <div className="flex items-end gap-2">
        {/* Model selector with connection mode */}
        {showModelPickerProp && (
          <div className="relative">
            <button
              type="button"
              onClick={() => { setShowModelPicker(!showModelPicker); }}
              disabled={isProcessing}
              className="flex h-[38px] items-center gap-1.5 rounded-lg border border-border-default bg-bg px-2 text-xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
            >
              <span className={`h-1.5 w-1.5 rounded-full ${anthropicProvider?.connectionMode === 'cli' ? 'bg-green-400' : 'bg-blue-400'}`} />
              <span className="max-w-[60px] truncate">{currentModel?.name}</span>
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3">
                <path fillRule="evenodd" d="M4.22 6.22a.75.75 0 0 1 1.06 0L8 8.94l2.72-2.72a.75.75 0 1 1 1.06 1.06l-3.25 3.25a.75.75 0 0 1-1.06 0L4.22 7.28a.75.75 0 0 1 0-1.06Z" clipRule="evenodd" />
              </svg>
            </button>

            {showModelPicker && (
              <div className="absolute bottom-full left-0 mb-1 w-48 rounded-lg border border-border-default bg-surface shadow-lg overflow-hidden z-50">
                <div className="px-3 py-2 border-b border-border-default bg-bg/50">
                  <div className="flex items-center gap-2 text-xs">
                    <span className={`h-1.5 w-1.5 rounded-full ${anthropicProvider?.connectionMode === 'cli' ? 'bg-green-400' : 'bg-blue-400'}`} />
                    <span className="text-text-secondary">
                      {anthropicProvider?.connectionMode === 'cli' ? 'CLI mode' : 'API mode'}
                    </span>
                  </div>
                </div>
                {models.map((model) => (
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
        )}

        {/* Effort level selector (controls thinking depth) */}
        {showThinkingPickerProp && (
          <div ref={effortPickerRef} className="relative">
            <Tooltip content="Reasoning effort (thinking depth)" side="top" delay={300}>
              <button
                type="button"
                onClick={() => { setShowEffortPicker(!showEffortPicker); }}
                disabled={isProcessing}
                className={`flex h-[38px] items-center gap-1 rounded-lg border px-2 text-xs transition-colors disabled:opacity-50 ${
                  selectedEffort !== 'default'
                    ? 'border-accent/50 bg-accent/10 text-accent'
                    : 'border-border-default bg-bg text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                }`}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.2">
                  <path d="M7 1v1.5M7 11.5V13M1 7h1.5M11.5 7H13M2.8 2.8l1.1 1.1M10.1 10.1l1.1 1.1M2.8 11.2l1.1-1.1M10.1 3.9l1.1-1.1" />
                </svg>
                <span>{EFFORT_LEVELS.find((l) => l.id === selectedEffort)?.label}</span>
              </button>
            </Tooltip>

            {showEffortPicker && (
              <div className="absolute bottom-full left-0 mb-1 w-44 rounded-lg border border-border-default bg-surface shadow-lg overflow-hidden z-50">
                <div className="px-3 py-1.5 border-b border-border-default bg-bg/50">
                  <span className="text-[10px] text-text-secondary uppercase tracking-wider">Effort Level</span>
                </div>
                {EFFORT_LEVELS.map((level) => (
                  <button
                    key={level.id}
                    type="button"
                    onClick={() => {
                      setSelectedEffort(level.id)
                      setShowEffortPicker(false)
                    }}
                    className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition-colors hover:bg-surface-hover ${
                      level.id === selectedEffort ? 'bg-surface-hover text-text-primary' : 'text-text-secondary'
                    }`}
                  >
                    <div>
                      <div className="font-medium text-text-primary">{level.label}</div>
                      <div className="text-text-secondary/70 text-[10px]">{level.description}</div>
                    </div>
                    {level.id === selectedEffort && (
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-4 w-4 text-accent">
                        <path fillRule="evenodd" d="M12.416 3.376a.75.75 0 0 1 .208 1.04l-5 7.5a.75.75 0 0 1-1.154.114l-3-3a.75.75 0 0 1 1.06-1.06l2.353 2.353 4.493-6.74a.75.75 0 0 1 1.04-.207Z" clipRule="evenodd" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <textarea
          ref={inputRef}
          value={voice.state === 'recording' ? voice.liveText : message}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={getPlaceholder()}
          rows={1}
          readOnly={voice.state === 'recording'}
          disabled={disabled || voice.state === 'processing'}
          className={`flex-1 resize-none rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-50 ${voice.state === 'recording' ? 'italic text-text-secondary' : ''}`}
          style={{ minHeight: '38px', maxHeight: '120px' }}
        />

        {/* Voice input button */}
        {showVoiceInput && (
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
                if (voice.state === 'recording') {
                  void voice.stopRecording()
                } else if (voice.state === 'idle' && voice.isAvailable) {
                  void voice.startRecording()
                } else if (voice.state === 'error') {
                  void voice.startRecording()
                }
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
        )}

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

        {/* Send button */}
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
