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

type SidebarMode = 'history' | 'files' | 'dashboard' | null

const COLLAPSED_HEIGHT = 40

export function OrchestratorPanel({ workspaceId }: OrchestratorPanelProps) {
  const loadTasks = useTaskStore((s) => s.load)
  const settings = useSettingsStore((s) => s.global)
  const anthropicProvider = settings.model.providers.find((p) => p.id === 'anthropic')
  const connectionMode = anthropicProvider?.connectionMode ?? 'cli'
  const apiKeyEnvVar = anthropicProvider?.apiKeyEnvVar || 'ANTHROPIC_API_KEY'
  const apiKey = settings.agent.envVars[apiKeyEnvVar] || undefined
  const { cliPath, isDetecting: cliDetecting, detectionError: cliDetectionError } = useCliPath()
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>(null)
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
        <div
          onClick={handleHeaderClick}
          className="relative flex select-none items-center justify-between px-3 py-1.5"
          style={{ cursor: 'pointer' }}
        >
          <div className="flex items-center gap-1">
            {!isPanelCollapsed && (
              <>
                <button
                  type="button"
                  onClick={() => { setSidebarMode(sidebarMode === 'history' ? null : 'history') }}
                  style={{ cursor: 'pointer' }}
                  className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
                    sidebarMode === 'history'
                      ? 'bg-surface-hover text-text-primary'
                      : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                  }`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path fillRule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm.75-13a.75.75 0 0 0-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 0 0 0-1.5h-3.25V5Z" clipRule="evenodd" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => { setSidebarMode(sidebarMode === 'files' ? null : 'files') }}
                  style={{ cursor: 'pointer' }}
                  className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
                    sidebarMode === 'files'
                      ? 'bg-surface-hover text-text-primary'
                      : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                  }`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path d="M3.75 3A1.75 1.75 0 0 0 2 4.75v3.26a3.235 3.235 0 0 1 1.75-.51h12.5c.644 0 1.245.188 1.75.51V6.75A1.75 1.75 0 0 0 16.25 5h-4.836a.25.25 0 0 1-.177-.073L9.823 3.513A1.75 1.75 0 0 0 8.586 3H3.75Z" />
                    <path fillRule="evenodd" d="M2 9.25a.75.75 0 0 1 .75-.75h14.5a.75.75 0 0 1 .75.75v5a1.75 1.75 0 0 1-1.75 1.75H3.75A1.75 1.75 0 0 1 2 14.25v-5Z" clipRule="evenodd" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={() => { setSidebarMode(sidebarMode === 'dashboard' ? null : 'dashboard') }}
                  style={{ cursor: 'pointer' }}
                  className={`flex h-6 w-6 items-center justify-center rounded-md transition-colors ${
                    sidebarMode === 'dashboard'
                      ? 'bg-surface-hover text-text-primary'
                      : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary'
                  }`}
                  title="Pipeline dashboard"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path d="M15.5 2A1.5 1.5 0 0 0 14 3.5v13a1.5 1.5 0 0 0 3 0v-13A1.5 1.5 0 0 0 15.5 2ZM10 7a1.5 1.5 0 0 0-1.5 1.5v8a1.5 1.5 0 0 0 3 0v-8A1.5 1.5 0 0 0 10 7ZM4.5 12A1.5 1.5 0 0 0 3 13.5v3a1.5 1.5 0 0 0 3 0v-3A1.5 1.5 0 0 0 4.5 12Z" />
                  </svg>
                </button>
              </>
            )}
          </div>

          <div className="absolute left-1/2 flex -translate-x-1/2 items-center gap-2">
            <span className="text-sm font-medium text-text-primary">Chef</span>
            {isProcessing && (
              <ProcessingIndicator startTime={chat.streaming.startTime} />
            )}
          </div>

          <div className="flex items-center gap-2">
            {!isPanelCollapsed && (
              <button
                type="button"
                onClick={() => { void handleNewChat() }}
                disabled={historyMessages.length === 0}
                style={{ cursor: historyMessages.length === 0 ? 'not-allowed' : 'pointer' }}
                className="flex h-6 items-center gap-1 rounded-md px-2 text-xs text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-secondary"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" fill="currentColor" className="h-3.5 w-3.5">
                  <path d="M8.75 3.75a.75.75 0 0 0-1.5 0v3.5h-3.5a.75.75 0 0 0 0 1.5h3.5v3.5a.75.75 0 0 0 1.5 0v-3.5h3.5a.75.75 0 0 0 0-1.5h-3.5v-3.5Z" />
                </svg>
                New
              </button>
            )}
            <span className="text-xs text-text-secondary">
              {isPanelCollapsed ? 'Cmd+J to expand' : 'Cmd+J'}
            </span>
            {!isPanelCollapsed && (
              <button
                type="button"
                onClick={() => { setPanelDock(isRightDock ? 'bottom' : 'right') }}
                title={isRightDock ? 'Dock to bottom' : 'Dock to right'}
                style={{ cursor: 'pointer' }}
                className="flex h-6 w-6 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
              >
                {isRightDock ? (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path fillRule="evenodd" d="M2 4.25A2.25 2.25 0 0 1 4.25 2h11.5A2.25 2.25 0 0 1 18 4.25v11.5A2.25 2.25 0 0 1 15.75 18H4.25A2.25 2.25 0 0 1 2 15.75V4.25ZM4.25 3.5a.75.75 0 0 0-.75.75v7.5h13V4.25a.75.75 0 0 0-.75-.75H4.25ZM3.5 13.25v2.5c0 .414.336.75.75.75h11.5a.75.75 0 0 0 .75-.75v-2.5h-13Z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                    <path fillRule="evenodd" d="M2 4.25A2.25 2.25 0 0 1 4.25 2h11.5A2.25 2.25 0 0 1 18 4.25v11.5A2.25 2.25 0 0 1 15.75 18H4.25A2.25 2.25 0 0 1 2 15.75V4.25ZM4.25 3.5a.75.75 0 0 0-.75.75v11.5c0 .414.336.75.75.75h7.5V3.5H4.25Zm9 0v13h2.5a.75.75 0 0 0 .75-.75V4.25a.75.75 0 0 0-.75-.75h-2.5Z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            )}
            <button
              type="button"
              onClick={togglePanel}
              style={{ cursor: 'pointer' }}
              className="flex h-6 w-6 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                {isRightDock ? (
                  <path
                    fillRule="evenodd"
                    d="M11.78 5.22a.75.75 0 0 1 0 1.06L8.06 10l3.72 3.72a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z"
                    clipRule="evenodd"
                  />
                ) : (
                  <path
                    fillRule="evenodd"
                    d="M5.22 8.22a.75.75 0 0 1 1.06 0L10 11.94l3.72-3.72a.75.75 0 1 1 1.06 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0L5.22 9.28a.75.75 0 0 1 0-1.06Z"
                    clipRule="evenodd"
                  />
                )}
              </svg>
            </button>
          </div>
        </div>

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

function ProcessingIndicator({ startTime }: { startTime: number | null }) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (!startTime) {
      setElapsed(0)
      return
    }

    const tick = () => {
      setElapsed(Math.floor((Date.now() - startTime) / 1000))
    }

    tick()
    const interval = window.setInterval(tick, 1000)
    return () => {
      window.clearInterval(interval)
    }
  }, [startTime])

  return (
    <span className="flex items-center gap-1 text-xs text-accent">
      <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      Thinking{elapsed > 0 ? `... ${String(elapsed)}s` : '...'}
    </span>
  )
}
