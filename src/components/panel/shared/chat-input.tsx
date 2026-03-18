/**
 * ChatInput - Unified input component for orchestrator and agent panels.
 * Owns reactive settings: 1M toggle, thinking level, permissions all
 * react to the selected model's auto-detected capabilities.
 *
 * Settings panel is collapsible: open by default, auto-collapses after
 * first message sent, then user-controlled via toggle.
 */

import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { useVoiceInput } from '@/hooks/use-voice-input'
import { useAttachments } from '@/hooks/use-attachments'
import { useModelCapabilities, type ModelId } from '@/hooks/use-model-capabilities'
import { Tooltip } from '@/components/shared/tooltip'
import { ModelSelector } from '@/components/shared/model-selector'
import { ThinkingSelector, type ThinkingLevel } from '@/components/shared/thinking-selector'
import { PermissionSelector, type PermissionMode } from '@/components/shared/permission-selector'
import { AttachmentButton } from './attachment-button'
import { AttachmentPreview } from './attachment-preview'
import type { Attachment } from '@/types'

export type { ModelId }
export type ModelSelection = { model: ModelId; extendedContext: boolean }

export type ChatInputConfig = {
  showModelSelector?: boolean
  showContextToggle?: boolean
  showThinkingSelector?: boolean
  showPermissionSelector?: boolean
  showVoiceInput?: boolean
  showAttachments?: boolean
  placeholder?: string
  rows?: number
}

export type ChatInputMessage = {
  content: string
  model: ModelId
  extendedContext?: boolean
  thinkingLevel?: ThinkingLevel
  permissionMode?: PermissionMode
  attachments?: Attachment[]
}

type ChatInputProps = {
  config?: ChatInputConfig
  onSend: (message: ChatInputMessage) => void
  onCancel?: () => void
  onInputChange?: () => void
  onAttachmentError?: (error: { file: string; message: string }) => void
  isProcessing?: boolean
  disabled?: boolean
  queueCount?: number
  /** Number of existing messages (for auto-collapse logic) */
  messageCount?: number
}

const DEFAULT_CONFIG: ChatInputConfig = {
  showModelSelector: true,
  showContextToggle: false,
  showThinkingSelector: false,
  showPermissionSelector: false,
  showVoiceInput: false,
  showAttachments: false,
  placeholder: 'Type a message...',
  rows: 1,
}

const LEVEL_ORDER = ['none', 'low', 'medium', 'high'] as const

export function ChatInput({
  config: userConfig,
  onSend,
  onCancel,
  onInputChange,
  onAttachmentError,
  isProcessing = false,
  disabled = false,
  queueCount = 0,
  messageCount = 0,
}: ChatInputProps) {
  const config = useMemo(() => ({ ...DEFAULT_CONFIG, ...userConfig }), [userConfig])

  const [message, setMessage] = useState('')
  const [model, setModel] = useState<ModelId>('sonnet')
  const [extendedContext, setExtendedContext] = useState(false)
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>('medium')
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('plan')
  const [isDragOver, setIsDragOver] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Settings panel collapse state
  // Open by default, auto-collapses after first send, then user-controlled
  const [settingsOpen, setSettingsOpen] = useState(true)
  const userToggledRef = useRef(false) // true once user manually toggles

  // Auto-detected model capabilities
  const { models, getCapabilities } = useModelCapabilities()
  const caps = getCapabilities(model)

  // Derived reactive state
  const supportsExtendedContext = caps.supportsExtendedContext
  const maxEffort = caps.maxEffort as ThinkingLevel
  const maxThinkingIdx = LEVEL_ORDER.indexOf(maxEffort)

  // Auto-clamp thinking level when model changes
  useEffect(() => {
    const currentIdx = LEVEL_ORDER.indexOf(thinkingLevel)
    if (currentIdx > maxThinkingIdx) {
      setThinkingLevel(maxEffort)
    }
  }, [model, maxEffort, maxThinkingIdx, thinkingLevel])

  // Auto-clear extended context when switching to a model that doesn't support it
  useEffect(() => {
    if (!supportsExtendedContext && extendedContext) {
      setExtendedContext(false)
    }
  }, [model, supportsExtendedContext, extendedContext])

  // Attachments hook
  const attachments = useAttachments({
    onError: onAttachmentError,
  })

  // Voice input
  const handleTranscript = useCallback((text: string) => {
    setMessage((prev) => {
      const separator = prev.trim() ? ' ' : ''
      return prev + separator + text
    })
    inputRef.current?.focus()
  }, [])

  const voice = useVoiceInput(handleTranscript)

  const handleModelChange = useCallback((modelId: ModelId) => {
    setModel(modelId)
  }, [])

  const handleContextToggle = useCallback(() => {
    if (!supportsExtendedContext) return
    setExtendedContext((prev) => !prev)
  }, [supportsExtendedContext])

  const handleSettingsToggle = useCallback(() => {
    userToggledRef.current = true
    setSettingsOpen((prev) => !prev)
  }, [])

  const handleSubmit = useCallback(() => {
    const trimmed = message.trim()
    const hasAttachments = attachments.attachments.length > 0
    if ((!trimmed && !hasAttachments) || disabled) return

    // Safety clamp thinking level at send time
    let effectiveThinking = thinkingLevel
    if (config.showThinkingSelector) {
      const currentIdx = LEVEL_ORDER.indexOf(thinkingLevel)
      if (currentIdx > maxThinkingIdx) {
        effectiveThinking = maxEffort
      }
    }

    onSend({
      content: trimmed,
      model,
      extendedContext: config.showContextToggle && supportsExtendedContext ? extendedContext : undefined,
      thinkingLevel: config.showThinkingSelector ? effectiveThinking : undefined,
      permissionMode: config.showPermissionSelector ? permissionMode : undefined,
      attachments: hasAttachments ? attachments.attachments : undefined,
    })

    setMessage('')
    attachments.clearAttachments()
    if (inputRef.current) {
      inputRef.current.style.height = 'auto'
    }

    // Auto-collapse settings after first send (unless user has manually toggled)
    if (!userToggledRef.current && settingsOpen) {
      setSettingsOpen(false)
    }
  }, [message, disabled, onSend, model, extendedContext, thinkingLevel, permissionMode, config, attachments, supportsExtendedContext, maxThinkingIdx, maxEffort, settingsOpen])

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

  // Handle paste event for images
  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    if (!config.showAttachments) return
    const items = e.clipboardData.items
    let hasImages = false
    for (let i = 0; i < items.length; i++) {
      if (items[i]?.type.startsWith('image/')) {
        hasImages = true
        break
      }
    }
    if (hasImages) {
      e.preventDefault()
      void attachments.addFromPaste(items)
    }
  }, [config.showAttachments, attachments])

  const handleDragOver = useCallback((e: React.DragEvent) => {
    if (!config.showAttachments) return
    e.preventDefault()
    setIsDragOver(true)
  }, [config.showAttachments])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    if (!config.showAttachments) return
    e.preventDefault()
    if (!containerRef.current?.contains(e.relatedTarget as Node)) {
      setIsDragOver(false)
    }
  }, [config.showAttachments])

  const handleDrop = useCallback((e: React.DragEvent) => {
    if (!config.showAttachments) return
    e.preventDefault()
    setIsDragOver(false)
    const files = e.dataTransfer.files
    if (files.length > 0) {
      void attachments.addFromDrop(files)
    }
  }, [config.showAttachments, attachments])

  // Auto-resize when voice liveText changes
  useEffect(() => {
    if (voice.state === 'recording' && inputRef.current) {
      inputRef.current.style.height = 'auto'
      inputRef.current.style.height = `${String(Math.min(inputRef.current.scrollHeight, 120))}px`
    }
  }, [voice.liveText, voice.state])

  // Auto-collapse if session already has messages on mount
  useEffect(() => {
    if (messageCount > 0 && !userToggledRef.current) {
      setSettingsOpen(false)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const showVoice = config.showVoiceInput
  const hasSelectors = config.showModelSelector || config.showThinkingSelector || config.showPermissionSelector || config.showContextToggle
  const hasAttachmentsPreview = attachments.attachments.length > 0
  const canSend = message.trim() || hasAttachmentsPreview

  // Model name for collapsed state
  const currentModelName = caps.name

  return (
    <div
      ref={containerRef}
      className={`border-t border-border-default bg-surface ${
        isDragOver ? 'ring-2 ring-accent ring-inset' : ''
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Attachment preview */}
      {config.showAttachments && (
        <AttachmentPreview
          attachments={attachments.attachments}
          onRemove={attachments.removeAttachment}
          disabled={disabled}
        />
      )}

      <div className="p-3">
        {/* Collapsible settings panel */}
        {hasSelectors && settingsOpen && (
          <div className="mb-2 flex items-center gap-1">
            {config.showModelSelector && (
              <ModelSelector
                value={model}
                models={models}
                onChange={handleModelChange}
              />
            )}

            {/* 1M context toggle — only visible when model supports it */}
            {config.showContextToggle && supportsExtendedContext && (
              <Tooltip
                content={extendedContext ? 'Extended context enabled (1M tokens)' : 'Enable extended context (1M tokens)'}
                side="top"
                delay={300}
              >
                <button
                  type="button"
                  onClick={handleContextToggle}
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
                onChange={setThinkingLevel}
              />
            )}
            {config.showPermissionSelector && (
              <PermissionSelector value={permissionMode} onChange={setPermissionMode} />
            )}
          </div>
        )}

        {/* Input row */}
        <div className="flex items-end gap-2">
          {/* Settings toggle — shows model name when collapsed */}
          {hasSelectors && (
            <Tooltip
              content={settingsOpen ? 'Hide settings' : 'Show settings'}
              side="top"
              delay={300}
            >
              <button
                type="button"
                onClick={handleSettingsToggle}
                className={`flex h-[38px] shrink-0 items-center gap-1 rounded-lg border px-2 text-xs transition-colors ${
                  settingsOpen
                    ? 'border-accent/30 bg-accent/5 text-accent'
                    : 'border-border-default bg-bg text-text-secondary hover:bg-bg-hover hover:text-text-primary'
                }`}
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="none"
                  className={`transition-transform ${settingsOpen ? 'rotate-180' : ''}`}
                >
                  <path d="M2.5 6L5 3.5L7.5 6" stroke="currentColor" strokeWidth="1.2" />
                </svg>
                {!settingsOpen && (
                  <span className="text-[10px] font-medium">{currentModelName}</span>
                )}
              </button>
            </Tooltip>
          )}

          {/* Attachment button */}
          {config.showAttachments && (
            <AttachmentButton
              onClick={() => { void attachments.addFromDialog() }}
              disabled={disabled}
              isLoading={attachments.isLoading}
              count={attachments.attachments.length}
            />
          )}

          <textarea
            ref={inputRef}
            value={voice.state === 'recording' ? voice.liveText : message}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            placeholder={
              isDragOver
                ? 'Drop files here...'
                : voice.state === 'recording'
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
            } ${isDragOver ? 'border-accent' : ''}`}
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
                      ? 'Enable voice in Settings'
                      : !voice.isApiAvailable
                        ? 'Download a model in Settings'
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

          {/* Cancel button */}
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
              disabled={!canSend || disabled}
              className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-lg bg-accent text-bg transition-colors hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path d="M3.105 2.288a.75.75 0 0 0-.826.95l1.414 4.926A1.5 1.5 0 0 0 5.135 9.25h6.115a.75.75 0 0 1 0 1.5H5.135a1.5 1.5 0 0 0-1.442 1.086l-1.414 4.926a.75.75 0 0 0 .826.95 28.897 28.897 0 0 0 15.293-7.155.75.75 0 0 0 0-1.114A28.897 28.897 0 0 0 3.105 2.288Z" />
              </svg>
            </button>
          </Tooltip>
        </div>
      </div>
    </div>
  )
}
