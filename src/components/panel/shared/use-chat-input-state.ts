import { useState, useRef, useCallback, useEffect } from 'react'
import { useVoiceInput } from '@/hooks/use-voice-input'
import { useAttachments } from '@/hooks/use-attachments'
import { useModelCapabilities, type ModelId } from '@/hooks/use-model-capabilities'
import { useSettingsStore } from '@/stores/settings-store'
import type { ThinkingLevel } from '@/components/shared/thinking-utils'
import type { PermissionMode } from '@/components/shared/permission-utils'
import {
  THINKING_LEVEL_ORDER,
  type ChatInputConfig,
  type ChatInputMessage,
} from './chat-input-types'

type UseChatInputStateArgs = {
  config: ChatInputConfig
  onSend: (message: ChatInputMessage) => void
  onInputChange?: () => void
  onAttachmentError?: (error: { file: string; message: string }) => void
  draftInsertion?: { id: number; content: string } | null
  disabled: boolean
}

export function useChatInputState({
  config,
  onSend,
  onInputChange,
  onAttachmentError,
  draftInsertion,
  disabled,
}: UseChatInputStateArgs) {
  const defaultPermissionMode = useSettingsStore((s) => s.global.agent.defaultPermissionMode)

  const [message, setMessage] = useState('')
  const [model, setModel] = useState<ModelId>('sonnet')
  const [extendedContext, setExtendedContext] = useState(false)
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>('medium')
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(defaultPermissionMode)
  const [isDragOver, setIsDragOver] = useState(false)

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const appliedDraftInsertionIdRef = useRef<number | null>(null)

  const { models, getCapabilities } = useModelCapabilities()
  const caps = getCapabilities(model)
  const supportsExtendedContext = caps.supportsExtendedContext
  const maxEffort = caps.maxEffort as ThinkingLevel
  const maxThinkingIdx = THINKING_LEVEL_ORDER.indexOf(maxEffort)

  useEffect(() => {
    const currentIdx = THINKING_LEVEL_ORDER.indexOf(thinkingLevel)
    if (currentIdx > maxThinkingIdx) {
      setThinkingLevel(maxEffort)
    }
  }, [maxEffort, maxThinkingIdx, thinkingLevel])

  useEffect(() => {
    if (!supportsExtendedContext && extendedContext) {
      setExtendedContext(false)
    }
  }, [supportsExtendedContext, extendedContext])

  const attachments = useAttachments({
    onError: onAttachmentError,
  })

  const handleTranscript = useCallback((text: string) => {
    setMessage((prev) => {
      const separator = prev.trim() ? ' ' : ''
      return prev + separator + text
    })
    inputRef.current?.focus()
  }, [])

  const voice = useVoiceInput(handleTranscript)

  useEffect(() => {
    if (!draftInsertion || appliedDraftInsertionIdRef.current === draftInsertion.id) return
    appliedDraftInsertionIdRef.current = draftInsertion.id
    setMessage((prev) => {
      const separator = prev.trim() ? '\n\n' : ''
      return `${prev.trimEnd()}${separator}${draftInsertion.content}`
    })
    onInputChange?.()
    window.requestAnimationFrame(() => {
      const el = inputRef.current
      if (!el) return
      el.focus()
      el.style.height = 'auto'
      el.style.height = `${String(Math.min(el.scrollHeight, 120))}px`
    })
  }, [draftInsertion, onInputChange])

  const handleModelChange = useCallback((modelId: ModelId) => {
    setModel(modelId)
  }, [])

  const handleContextToggle = useCallback(() => {
    if (!supportsExtendedContext) return
    setExtendedContext((prev) => !prev)
  }, [supportsExtendedContext])

  const handleSubmit = useCallback(() => {
    const trimmed = message.trim()
    const hasAttachments = attachments.attachments.length > 0
    if ((!trimmed && !hasAttachments) || disabled) return

    let effectiveThinking = thinkingLevel
    if (config.showThinkingSelector) {
      const currentIdx = THINKING_LEVEL_ORDER.indexOf(thinkingLevel)
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
  }, [
    attachments,
    config,
    disabled,
    extendedContext,
    maxEffort,
    maxThinkingIdx,
    message,
    model,
    onSend,
    permissionMode,
    supportsExtendedContext,
    thinkingLevel,
  ])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }, [handleSubmit])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = `${String(Math.min(e.target.scrollHeight, 120))}px`
    onInputChange?.()
  }, [onInputChange])

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

  useEffect(() => {
    if (voice.state === 'recording' && inputRef.current) {
      inputRef.current.style.height = 'auto'
      inputRef.current.style.height = `${String(Math.min(inputRef.current.scrollHeight, 120))}px`
    }
  }, [voice.liveText, voice.state])

  return {
    message,
    model,
    extendedContext,
    thinkingLevel,
    permissionMode,
    isDragOver,
    inputRef,
    containerRef,
    models,
    supportsExtendedContext,
    maxEffort,
    attachments,
    voice,
    showVoice: config.showVoiceInput,
    hasSelectors: config.showModelSelector || config.showThinkingSelector || config.showPermissionSelector || config.showContextToggle,
    canSend: message.trim().length > 0 || attachments.attachments.length > 0,
    currentModelName: caps.name,
    currentContextWindow: caps.contextWindow,
    setThinkingLevel,
    setPermissionMode,
    handleModelChange,
    handleContextToggle,
    handleSubmit,
    handleKeyDown,
    handleChange,
    handlePaste,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  }
}
