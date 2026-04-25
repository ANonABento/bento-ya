import { useState, useCallback, useEffect } from 'react'
import type { Task } from '@/types'
import { buildPromptWithAttachments } from '@/types'
import { thinkingToEffort } from '@/components/shared/thinking-utils'
import { useChatSession } from '@/hooks/chat-session'
import { useCliPath } from '@/hooks/use-cli-path'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { mapMessages, mapToolCalls, type ChatInputMessage } from './shared'

export function useAgentPanelSession(task: Task) {
  const [localError, setLocalError] = useState<string | null>(null)

  const workspace = useWorkspaceStore((s) =>
    s.workspaces.find((w) => w.id === task.workspaceId)
  )
  const workingDir = workspace?.repoPath ?? ''

  const {
    cliPath,
    isDetecting: cliDetecting,
    detectionError: cliDetectionError,
  } = useCliPath()

  const chat = useChatSession({
    mode: 'agent',
    taskId: task.id,
    workingDir,
    cliPath,
    onError: (err) => {
      console.error('[AgentPanel]', err)
      setLocalError(err)
    },
  })

  const error = localError ?? chat.error ?? cliDetectionError

  useEffect(() => {
    if (chat.error) {
      setLocalError(chat.error)
    }
  }, [chat.error])

  const handleInputChange = useCallback(() => {
    if (!error) return
    setLocalError(null)
    chat.clearError()
  }, [error, chat])

  const handleSendMessage = useCallback(async (message: ChatInputMessage) => {
    const effortLevel = message.thinkingLevel
      ? thinkingToEffort(message.thinkingLevel)
      : undefined
    const prompt = buildPromptWithAttachments(message.content, message.attachments)
    await chat.sendMessage(prompt, message.model, effortLevel)
  }, [chat])

  const handleClearHistory = useCallback(async () => {
    if (!window.confirm('Clear all messages for this task?')) return
    await chat.clearMessages()
  }, [chat])

  const clearDisplayedError = useCallback(() => {
    setLocalError(null)
    chat.clearError()
  }, [chat])

  const handleAttachmentError = useCallback((attachmentError: { file: string; message: string }) => {
    setLocalError(`${attachmentError.file}: ${attachmentError.message}`)
  }, [])

  return {
    chat,
    cliDetecting,
    error,
    chatMessages: mapMessages(chat.messages, task.workspaceId, task.id),
    toolCalls: mapToolCalls(chat.streaming.toolCalls),
    handleAttachmentError,
    handleClearHistory,
    handleInputChange,
    handleSendMessage,
    clearDisplayedError,
  }
}
