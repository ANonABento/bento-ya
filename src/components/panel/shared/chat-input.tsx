/**
 * ChatInput - Unified input component for orchestrator and agent panels.
 * Single source of truth for chat input UI.
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { useVoiceInput } from '@/hooks/use-voice-input'
import { Tooltip } from '@/components/shared/tooltip'
import { ModelSelector, type ModelSelection } from '@/components/shared/model-selector'
import { ThinkingSelector, type ThinkingLevel } from '@/components/shared/thinking-selector'
import { PermissionSelector, type PermissionMode } from '@/components/shared/permission-selector'

export type { ModelSelection }
export type ModelId = ModelSelection['model']

export type ChatInputConfig = {
  /** Show model selector */
  showModelSelector?: boolean
  /** Show 1M context toggle next to model */
  showContextToggle?: boolean
  /** Show thinking level selector */
  showThinkingSelector?: boolean
  /** Show permission mode selector */
  showPermissionSelector?: boolean
  /** Show voice input button */
  showVoiceInput?: boolean
  /** Placeholder text */
  placeholder?: string
  /** Number of rows for textarea */
  rows?: number
}

export type ChatInputMessage = {
  content: string
  model: ModelId
  extendedContext?: boolean
  thinkingLevel?: ThinkingLevel
  permissionMode?: PermissionMode
}

type ChatInputProps = {
  /** Configuration for input features */
  config?: ChatInputConfig
  /** Called when user sends a message */
  onSend: (message: ChatInputMessage) => void
  /** Called when user cancels processing */
  onCancel?: () => void
  /** Called when input value changes (for error clearing) */
  onInputChange?: () => void
  /** Whether currently processing a message */
  isProcessing?: boolean
  /** Whether input is disabled */
  disabled?: boolean
  /** Number of queued messages */
  queueCount?: number
}

const DEFAULT_CONFIG: ChatInputConfig = {
  showModelSelector: true,
  showContextToggle: false,
  showThinkingSelector: false,
  showPermissionSelector: false,
  showVoiceInput: false,
  placeholder: 'Type a message...',
  rows: 1,
}

export function ChatInput({
  config: userConfig,
  onSend,
  onCancel,
  onInputChange,
  isProcessing = false,
  disabled = false,
  queueCount = 0,
}: ChatInputProps) {
  const config = { ...DEFAULT_CONFIG, ...userConfig }

  const [message, setMessage] = useState('')
  const [model, setModel] = useState<ModelId>('sonnet')
  const [extendedContext, setExtendedContext] = useState(false)
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>('medium')
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('plan')
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Voice input - append transcript to current message
  const handleTranscript = useCallback((text: string) => {
    setMessage((prev) => {
      const separator = prev.trim() ? ' ' : ''
      return prev + separator + text
    })
    inputRef.current?.focus()
  }, [])

  const voice = useVoiceInput(handleTranscript)

  const handleModelChange = useCallback((selection: ModelSelection) => {
    setModel(selection.model)
    setExtendedContext(selection.extendedContext)
  }, [])

  const handleSubmit = useCallback(() => {
    const trimmed = message.trim()
    if (!trimmed || disabled) return

    onSend({
      content: trimmed,
      model,
      extendedContext: config.showContextToggle ? extendedContext : undefined,
      thinkingLevel: config.showThinkingSelector ? thinkingLevel : undefined,
      permissionMode: config.showPermissionSelector ? permissionMode : undefined,
    })

    setMessage('')
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
    }
  }, [message, disabled, onSend, model, extendedContext, thinkingLevel, permissionMode, config])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit]
  )

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = `${String(Math.min(e.target.scrollHeight, 120))}px`
    onInputChange?.()
  }

  // Auto-resize when voice liveText changes
  useEffect(() => {
    if (voice.state === 'recording' && inputRef.current) {
      inputRef.current.style.height = 'auto'
      inputRef.current.style.height = `${String(Math.min(inputRef.current.scrollHeight, 120))}px`
    }
  }, [voice.liveText, voice.state])

  // Always show voice button if enabled in config (with helpful tooltip when unavailable)
  const showVoice = config.showVoiceInput
  const showSelectorsRow = config.showModelSelector || config.showThinkingSelector || config.showPermissionSelector

  return (
    <div className="border-t border-border-default bg-surface p-3">
      {/* Optional selectors row */}
      {showSelectorsRow && (
        <div className="mb-2 flex items-center gap-1">
          {config.showModelSelector && (
            <ModelSelector
              value={model}
              extendedContext={extendedContext}
              showContextToggle={config.showContextToggle}
              onChange={handleModelChange}
            />
          )}
          {config.showThinkingSelector && (
            <ThinkingSelector value={thinkingLevel} onChange={setThinkingLevel} />
          )}
          {config.showPermissionSelector && (
            <PermissionSelector value={permissionMode} onChange={setPermissionMode} />
          )}
        </div>
      )}

      {/* Input row */}
      <div className="flex items-end gap-2">
        <textarea
          ref={inputRef}
          value={voice.state === 'recording' ? voice.liveText : message}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={
            voice.state === 'recording'
              ? 'Listening...'
              : voice.state === 'processing'
                ? 'Transcribing...'
                : config.placeholder
          }
          rows={config.rows}
          readOnly={voice.state === 'recording'}
          disabled={disabled || voice.state === 'processing'}
          className={`flex-1 resize-none rounded-lg border border-border-default bg-bg px-3 py-2 text-sm text-text-primary placeholder:text-text-secondary/50 focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-50 ${
            voice.state === 'recording' ? 'italic text-text-secondary' : ''
          }`}
          style={{ minHeight: '38px', maxHeight: '120px' }}
        />

        {/* Voice input button */}
        {showVoice && (
          <Tooltip
            content={
              voice.state === 'recording'
                ? `Recording (${String(voice.duration)}s) - click to stop`
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
        {isProcessing && onCancel && (
          <Tooltip content={queueCount > 0 ? `Cancel (${String(queueCount)} queued)` : 'Cancel'} side="top" delay={200}>
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
