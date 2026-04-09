import { useState, useRef, useCallback, useEffect } from 'react'
import { useVoiceInput } from '@/hooks/use-voice-input'
import { useAttachments } from '@/hooks/use-attachments'
import { useModelCapabilities, type ModelId } from '@/hooks/use-model-capabilities'
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
  disabled: boolean
  messageCount: number
}

export function useChatInputState({
  config,
  onSend,
  onInputChange,
  onAttachmentError,
  disabled,
  messageCount,
}: UseChatInputStateArgs) {
  const [message, setMessage] = useState('')
  const [model, setModel] = useState<ModelId>('sonnet')
  const [extendedContext, setExtendedContext] = useState(false)
  const [thinkingLevel, setThinkingLevel] = useState<ThinkingLevel>('medium')
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('plan')
  const [isDragOver, setIsDragOver] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(true)

  const inputRef = useRef<HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const userToggledRef = useRef(false)
  const hasAutoCollapsed = useRef(false)

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

    if (!userToggledRef.current && settingsOpen) {
      setSettingsOpen(false)
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
    settingsOpen,
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

  useEffect(() => {
    if (messageCount > 0 && !userToggledRef.current && !hasAutoCollapsed.current) {
      hasAutoCollapsed.current = true
      setSettingsOpen(false)
    }
  }, [messageCount])

  return {
    message,
    model,
    extendedContext,
    thinkingLevel,
    permissionMode,
    isDragOver,
    settingsOpen,
    inputRef,
    containerRef,
    models,
    supportsExtendedContext,
    maxEffort,
    attachments,
    voice,
    showVoice: config.showVoiceInput,
    hasSelectors: config.showModelSelector || config.showThinkingSelector || config.showPermissionSelector || config.showContextToggle,
    canSend: message.trim() || attachments.attachments.length > 0,
    currentModelName: caps.name,
    setThinkingLevel,
    setPermissionMode,
    handleModelChange,
    handleContextToggle,
    handleSettingsToggle,
    handleSubmit,
    handleKeyDown,
    handleChange,
    handlePaste,
    handleDragOver,
    handleDragLeave,
    handleDrop,
  }
}
