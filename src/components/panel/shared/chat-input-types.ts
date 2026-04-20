import type { ModelId } from '@/hooks/use-model-capabilities'
import type { ThinkingLevel } from '@/components/shared/thinking-utils'
import type { PermissionMode } from '@/components/shared/permission-utils'
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

export type ChatInputProps = {
  config?: ChatInputConfig
  onSend: (message: ChatInputMessage) => void
  onCancel?: () => void
  onInputChange?: () => void
  onAttachmentError?: (error: { file: string; message: string }) => void
  isProcessing?: boolean
  disabled?: boolean
  queueCount?: number
  messageCount?: number
}

export const DEFAULT_CHAT_INPUT_CONFIG: ChatInputConfig = {
  showModelSelector: true,
  showContextToggle: false,
  showThinkingSelector: false,
  showPermissionSelector: false,
  showVoiceInput: false,
  showAttachments: false,
  placeholder: 'Type a message...',
  rows: 1,
}

export const THINKING_LEVEL_ORDER = ['none', 'low', 'medium', 'high'] as const
