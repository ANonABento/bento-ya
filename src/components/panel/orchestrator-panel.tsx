import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { buildPromptWithAttachments } from '@/types'
import { thinkingToEffort } from '@/components/shared/thinking-utils'
import { useTaskStore } from '@/stores/task-store'
import { useSettingsStore } from '@/stores/settings-store'
import { useCliPath } from '@/hooks/use-cli-path'
import { useChatSession } from '@/hooks/chat-session'
import { useOrchestratorSessions } from '@/hooks/use-orchestrator-sessions'
import { ResizeHandle } from '@/components/shared/resize-handle'
import { useOrchestratorPanelLayout } from './use-orchestrator-panel-layout'
import { useOrchestratorTaskRefresh } from './use-orchestrator-task-refresh'
import { ChatErrorBoundary } from './chat-error-boundary'
import { ChatHistory } from './chat-history'
import { OrchestratorPanelHeader } from './orchestrator-panel-header'
import type { OrchestratorSidebarMode } from './orchestrator-panel-shared'
import { PanelSidebar } from './panel-sidebar'
import { PipelineDashboard } from './pipeline-dashboard'
import {
  ChatInput,
  CliDetectingBanner,
  ErrorBanner,
  FailedMessageBanner,
  mapMessages,
  mapToolCalls,
  type ChatInputMessage,
} from './shared'

type OrchestratorPanelProps = {
  workspaceId: string
}

const COLLAPSED_HEIGHT = 40

export function OrchestratorPanel({ workspaceId }: OrchestratorPanelProps) {
  const loadTasks = useTaskStore((s) => s.load)
  const settings = useSettingsStore((s) => s.global)
  const anthropicProvider = settings.model.providers.find((p) => p.id === 'anthropic')
  const connectionMode = anthropicProvider?.connectionMode ?? 'cli'
  const apiKeyEnvVar = anthropicProvider?.apiKeyEnvVar || 'ANTHROPIC_API_KEY'
  const apiKey = settings.agent.envVars[apiKeyEnvVar] || undefined
  const { cliPath, isDetecting: cliDetecting, detectionError: cliDetectionError } = useCliPath()
  const [sidebarMode, setSidebarMode] = useState<OrchestratorSidebarMode | null>(null)
  const [localError, setLocalError] = useState<string | null>(null)

  const {
    panelRef,
    isPanelCollapsed,
    isRightDock,
    isDragging,
    displayHeight,
    displayWidth,
    setPanelDock,
    togglePanel,
    handleResizeMouseDown,
    handleHeaderClick,
  } = useOrchestratorPanelLayout()

  const {
    sessions,
    activeSession,
    isLoading: sessionsLoading,
    createSession,
    switchSession,
    deleteSession,
    refreshSessions,
    resetSession,
  } = useOrchestratorSessions(workspaceId)

  const chat = useChatSession({
    mode: 'orchestrator',
    workspaceId,
    sessionId: activeSession?.id,
    connectionMode,
    cliPath,
    apiKey: apiKey || undefined,
    apiKeyEnvVar,
    onError: (err) => {
      setLocalError(err)
    },
    onToolResult: () => {
      void loadTasks(workspaceId)
    },
    onComplete: () => {
      void refreshSessions()
    },
  })

  useOrchestratorTaskRefresh(workspaceId, loadTasks)

  useEffect(() => {
    if (chat.error) {
      setLocalError(chat.error)
    }
  }, [chat.error])

  const error = localError ?? chat.error ?? cliDetectionError
  const isLoading = sessionsLoading || chat.isLoading
  const isProcessing = chat.streaming.isStreaming
  const historyMessages = activeSession
    ? mapMessages(chat.messages, workspaceId, activeSession.id)
    : []
  const toolCalls = mapToolCalls(chat.streaming.toolCalls)

  const clearDisplayedError = useCallback(() => {
    setLocalError(null)
    chat.clearError()
  }, [chat])

  const handleInputChange = useCallback(() => {
    if (!error) return
    clearDisplayedError()
  }, [clearDisplayedError, error])

  const handleSendMessage = useCallback(async (message: ChatInputMessage) => {
    if (!chat.canSend) return

    const effortLevel = message.thinkingLevel
      ? thinkingToEffort(message.thinkingLevel)
      : undefined
    const prompt = buildPromptWithAttachments(message.content, message.attachments)
    await chat.sendMessage(prompt, message.model, effortLevel)
  }, [chat])

  const handleCancel = useCallback(async () => {
    await chat.cancel()
  }, [chat])

  const handleNewChat = useCallback(async () => {
    if (chat.messages.length === 0) return

    try {
      if (activeSession) {
        await resetSession()
      }
      await createSession()
    } catch (err) {
      console.error('[OrchestratorPanel] Failed to create new chat:', err)
    }
  }, [activeSession, chat.messages.length, createSession, resetSession])

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    try {
      await deleteSession(sessionId)
    } catch (err) {
      console.error('[OrchestratorPanel] Failed to delete session:', err)
    }
  }, [deleteSession])

  const handleToggleSidebar = useCallback((mode: OrchestratorSidebarMode) => {
    setSidebarMode((currentMode) => (currentMode === mode ? null : mode))
  }, [])

  return (
    <div className={`relative ${isRightDock ? 'flex h-full' : ''}`}>
      {!isPanelCollapsed && (
        <ResizeHandle
          direction={isRightDock ? 'horizontal' : 'vertical'}
          position={isRightDock ? 'left' : 'top'}
          onMouseDown={handleResizeMouseDown}
        />
      )}

      <motion.div
        ref={panelRef}
        initial={false}
        animate={
          isRightDock
            ? { width: isPanelCollapsed ? COLLAPSED_HEIGHT : displayWidth }
            : { height: displayHeight }
        }
        transition={isDragging ? { duration: 0 } : { type: 'spring', stiffness: 500, damping: 35 }}
        className={`flex flex-col overflow-hidden bg-surface ${
          isRightDock ? 'h-full border-l border-border-default' : 'border-t border-border-default'
        }`}
        style={isRightDock ? { minWidth: COLLAPSED_HEIGHT } : { minHeight: COLLAPSED_HEIGHT }}
      >
        <OrchestratorPanelHeader
          isPanelCollapsed={isPanelCollapsed}
          isRightDock={isRightDock}
          sidebarMode={sidebarMode}
          isProcessing={isProcessing}
          processingStartTime={chat.streaming.startTime}
          canCreateNewChat={historyMessages.length > 0}
          onHeaderClick={handleHeaderClick}
          onToggleSidebar={handleToggleSidebar}
          onNewChat={() => { void handleNewChat() }}
          onToggleDock={() => { setPanelDock(isRightDock ? 'bottom' : 'right') }}
          onTogglePanel={togglePanel}
        />

        <AnimatePresence>
          {!isPanelCollapsed && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="flex flex-1 overflow-hidden"
            >
              {sidebarMode === 'dashboard' ? (
                <PipelineDashboard workspaceId={workspaceId} />
              ) : (
                <PanelSidebar
                  mode={sidebarMode}
                  sessions={sessions}
                  activeSessionId={activeSession?.id}
                  workspaceId={workspaceId}
                  isCurrentChatEmpty={historyMessages.length === 0}
                  onNewChat={() => { void handleNewChat() }}
                  onSelectSession={switchSession}
                  onDeleteSession={(sessionId) => { void handleDeleteSession(sessionId) }}
                />
              )}

              <ChatErrorBoundary panelName="Orchestrator Chat">
                <div className="flex flex-1 flex-col overflow-hidden">
                  {cliDetecting && <CliDetectingBanner />}
                  {error && !chat.failedMessage && !cliDetecting && (
                    <ErrorBanner error={error} onDismiss={clearDisplayedError} />
                  )}
                  {chat.failedMessage && (
                    <FailedMessageBanner
                      error={chat.failedMessage.error}
                      onRetry={() => { void chat.retryFailed() }}
                      onDismiss={chat.dismissFailed}
                    />
                  )}
                  <ChatHistory
                    messages={historyMessages}
                    isLoading={isLoading}
                    streamingContent={chat.streaming.content}
                    processingStartTime={chat.streaming.startTime}
                    thinkingContent={chat.streaming.thinkingContent}
                    toolCalls={toolCalls}
                    onCancel={() => { void handleCancel() }}
                    queuedMessages={chat.queue}
                  />
                  <ChatInput
                    config={{
                      showModelSelector: true,
                      showContextToggle: true,
                      showThinkingSelector: true,
                      showPermissionSelector: true,
                      showVoiceInput: true,
                      showAttachments: true,
                      placeholder: 'Ask me to create tasks...',
                    }}
                    onSend={(message) => { void handleSendMessage(message) }}
                    onCancel={() => { void handleCancel() }}
                    onInputChange={handleInputChange}
                    onAttachmentError={(attachmentError) => {
                      setLocalError(`${attachmentError.file}: ${attachmentError.message}`)
                    }}
                    isProcessing={isProcessing}
                    disabled={!chat.canSend || cliDetecting}
                    queueCount={chat.queue.length}
                    messageCount={chat.messages.length}
                  />
                </div>
              </ChatErrorBoundary>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  )
}
