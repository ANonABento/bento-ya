import { useEffect, useState, type ReactNode } from 'react'
import type { Task } from '@/types'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useAgentTranscriptStore } from '@/stores/agent-transcript-store'
import { holdTask, killTaskSession } from '@/lib/ipc/agent'
import { signalPtyInterrupt } from '@/lib/ipc/terminal'
import { TerminalView } from './terminal-view'
import { ChatInput } from './shared'
import { AgentTranscript } from './agent-transcript'
import { useAgentPanelSession } from './use-agent-panel-session'

type AgentPanelProps = {
  task: Task
  onClose?: () => void
}

type PanelView = 'transcript' | 'terminal'

export function AgentPanel({ task, onClose }: AgentPanelProps) {
  const workspace = useWorkspaceStore((s) =>
    s.workspaces.find((w) => w.id === task.workspaceId)
  )
  const workingDir = task.worktreePath ?? workspace?.repoPath ?? ''
  const session = useAgentPanelSession(task)
  const transcriptState = useAgentTranscriptStore((s) => s.getTaskState(task.id))
  const loadTranscript = useAgentTranscriptStore((s) => s.load)
  const subscribeTranscript = useAgentTranscriptStore((s) => s.subscribe)
  const unsubscribeTranscript = useAgentTranscriptStore((s) => s.unsubscribe)
  const [activeView, setActiveView] = useState<PanelView>('transcript')
  const [stopBusy, setStopBusy] = useState(false)
  const [holdBusy, setHoldBusy] = useState(false)
  const [killBusy, setKillBusy] = useState(false)

  const isAgentRunning = task.agentStatus === 'running'
  const stopDisabled = stopBusy || !isAgentRunning
  const runtimeMode = task.agentMode === 'managed' ? 'managed' : 'terminal'
  const hasResumeContext = transcriptState.events.some((event) =>
    event.eventType === 'agent_completed' ||
    event.eventType === 'agent_failed' ||
    event.eventType === 'agent_cancelled' ||
    event.eventType === 'session_started'
  )
  const inputDelivery = isAgentRunning
    ? runtimeMode === 'managed'
      ? 'Running · message will queue for the next managed turn'
      : 'Running · message steers the live terminal agent'
    : hasResumeContext
      ? 'Idle · next message resumes this agent context'
      : 'Idle · next message starts a new agent run'
  const submitLabel = isAgentRunning
    ? runtimeMode === 'managed'
      ? 'Queue next turn'
      : 'Steer live agent'
    : hasResumeContext
      ? 'Resume agent'
      : 'Start agent'

  useEffect(() => {
    void loadTranscript(task.id)
    void subscribeTranscript(task.id)
    return () => {
      unsubscribeTranscript()
    }
  }, [loadTranscript, subscribeTranscript, task.id, unsubscribeTranscript])

  const handleStop = async () => {
    if (stopDisabled) return
    setStopBusy(true)
    try {
      await signalPtyInterrupt(task.id)
    } catch (err) {
      // Most common cause: no tmux session (e.g. manual task with bare shell
      // that was already terminated). The error is informational only.
      console.warn(`[agent-panel] stop failed for ${task.id}:`, err)
    } finally {
      // Brief debounce so the button can't be re-fired before the signal lands.
      setTimeout(() => { setStopBusy(false) }, 300)
    }
  }

  const handleHoldToggle = async () => {
    if (holdBusy) return
    setHoldBusy(true)
    try {
      await holdTask(task.id, !task.heldByUser)
    } catch (err) {
      console.warn(`[agent-panel] hold toggle failed for ${task.id}:`, err)
    } finally {
      setHoldBusy(false)
    }
  }

  const handleKill = async () => {
    if (killBusy) return
    if (!window.confirm('Kill this task session? The terminal scrollback and running process will be removed.')) {
      return
    }
    setKillBusy(true)
    try {
      await killTaskSession(task.id)
    } catch (err) {
      console.warn(`[agent-panel] kill session failed for ${task.id}:`, err)
    } finally {
      setKillBusy(false)
    }
  }

  return (
    <div data-testid="agent-panel" className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border-default bg-bg">
        <div className="flex items-center justify-between gap-3 px-3 py-2">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {onClose && (
              <button
                type="button"
                onClick={onClose}
                className="rounded p-1 text-text-secondary hover:bg-surface-hover hover:text-text-primary"
                title="Close panel (Esc)"
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M5 3l5 4-5 4" />
                </svg>
              </button>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-text-primary">{task.title}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-text-secondary">
                <span>{task.model ?? 'agent'}</span>
                <span className="text-text-secondary/40">/</span>
                <span>{workingDir || 'no workdir'}</span>
              </div>
            </div>
            <div className="inline-flex shrink-0 rounded-md border border-border-default bg-surface p-0.5">
              <ViewButton
                active={activeView === 'transcript'}
                onClick={() => { setActiveView('transcript') }}
                testId="agent-panel-tab-transcript"
              >
                Transcript
              </ViewButton>
              <ViewButton
                active={activeView === 'terminal'}
                onClick={() => { setActiveView('terminal') }}
                testId="agent-panel-tab-terminal"
              >
                Terminal
              </ViewButton>
            </div>
          </div>

          <div className="inline-flex shrink-0 items-center gap-1.5 text-xs">
            {isAgentRunning && (
              <span className="inline-flex items-center gap-1 rounded bg-running/10 px-1.5 py-0.5 text-[10px] text-running">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-running" />
                live
              </span>
            )}
          <button
            type="button"
            onClick={() => { void handleHoldToggle() }}
            disabled={holdBusy}
            data-testid="agent-panel-hold-button"
            title={task.heldByUser ? 'Release auto-advance hold' : 'Hold auto-advance for this task'}
            className={`rounded border px-2 py-0.5 text-[11px] font-medium disabled:opacity-50 ${
              task.heldByUser
                ? 'border-warning/40 bg-warning/10 text-warning'
                : 'border-border-default bg-surface text-text-secondary hover:bg-surface-hover hover:text-text-primary'
            }`}
            style={{ cursor: holdBusy ? 'wait' : 'pointer' }}
          >
            {task.heldByUser ? 'Held' : 'Hold'}
          </button>
          <button
            type="button"
            onClick={() => { void handleStop() }}
            disabled={stopDisabled}
            data-testid="agent-panel-stop-button"
            title="Send Ctrl+C to the agent (does not kill the session)"
            className="rounded border border-border-default bg-surface px-2 py-0.5 text-[11px] font-medium text-text-secondary hover:bg-surface-hover hover:text-text-primary disabled:opacity-50"
            style={{ cursor: stopBusy ? 'wait' : stopDisabled ? 'not-allowed' : 'pointer' }}
          >
            Stop
          </button>
          <button
            type="button"
            onClick={() => { void handleKill() }}
            disabled={killBusy}
            data-testid="agent-panel-kill-button"
            title="Kill the tmux session"
            className="rounded border border-error/30 bg-surface px-2 py-0.5 text-[11px] font-medium text-error hover:bg-error/10 disabled:opacity-50"
            style={{ cursor: killBusy ? 'wait' : 'pointer' }}
          >
            Kill
          </button>
          </div>
        </div>

        {session.error && (
          <div className="px-3 pb-2">
            <button
              type="button"
              onClick={session.clearDisplayedError}
              className="truncate text-[11px] text-error hover:text-error/80"
              title={session.error}
            >
              {session.error}
            </button>
          </div>
        )}
      </div>

      <div className="relative min-h-0 flex-1">
        {activeView === 'transcript' ? (
          <div className="flex h-full flex-col">
            <AgentTranscript
              events={transcriptState.events}
              isLoading={session.chat.isLoading || transcriptState.isLoading}
              processingStartTime={session.chat.streaming.startTime}
              queuedMessages={session.chat.queue}
              onCancel={() => { void session.chat.cancel() }}
            />
            <ChatInput
              config={{
                placeholder: 'Steer the agent... /commands, @files, !shell',
                showModelSelector: true,
                showThinkingSelector: true,
                showVoiceInput: true,
                showAttachments: true,
                rows: 1,
              }}
              onSend={(message) => { void session.handleSendMessage(message) }}
              onCancel={() => { void session.chat.cancel() }}
              onInputChange={session.handleInputChange}
              onAttachmentError={session.handleAttachmentError}
              deliveryHint={inputDelivery}
              submitLabel={submitLabel}
              isProcessing={session.chat.streaming.isStreaming || isAgentRunning}
              disabled={!session.chat.canSend || session.cliDetecting}
              queueCount={session.chat.queue.length}
            />
          </div>
        ) : (
          <TerminalView taskId={task.id} workingDir={workingDir} />
        )}
      </div>
    </div>
  )
}

function ViewButton({
  active,
  onClick,
  children,
  testId,
}: {
  active: boolean
  onClick: () => void
  children: ReactNode
  testId: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`rounded px-2 py-1 text-[11px] font-medium transition-colors ${
        active
          ? 'bg-bg text-text-primary shadow-sm'
          : 'text-text-secondary hover:text-text-primary'
      }`}
    >
      {children}
    </button>
  )
}
