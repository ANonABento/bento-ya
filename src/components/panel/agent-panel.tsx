import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { Task } from '@/types'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { useAgentTranscriptStore } from '@/stores/agent-transcript-store'
import { holdTask, killTaskSession } from '@/lib/ipc/agent'
import { agentInjectMessage } from '@/lib/ipc/agent-interactive'
import { signalPtyInterrupt } from '@/lib/ipc/terminal'
import { useResolvedRuntimeMode } from '@/hooks/use-resolved-runtime-mode'
import { useTaskDetail } from '@/hooks/use-task-detail'
import { TerminalView } from './terminal-view'
import { InteractiveAgentView } from './interactive-agent-view'
import { ChatInput, type ChatInputMessage } from './shared'
import { AgentTranscript } from './agent-transcript'
import { useAgentPanelSession } from './use-agent-panel-session'
import { DiffSection } from '@/components/task-detail/diff-section'
import { CommitsSection } from '@/components/task-detail/commits-section'

type AgentPanelProps = {
  task: Task
  onClose?: () => void
}

type PanelView = 'activity' | 'terminal' | 'changes'

/**
 * Dispatch the agent panel by resolved runtime mode.
 *
 * - `interactive` → `InteractivePanel` (xterm + control bar, input routed
 *   to `agent_inject_message`). Never instantiates `useChatSession`.
 * - `headless` → `HeadlessPanel` (existing chat bubbles / terminal toggle).
 *
 * The `key` prop forces a full unmount on mode change so neither half
 * leaks listeners or stale state into the other.
 */
export function AgentPanel(props: AgentPanelProps) {
  const { task } = props
  const { mode, isLoading } = useResolvedRuntimeMode(task.id)

  if (isLoading) {
    return (
      <div
        data-testid="agent-panel-loading"
        className="flex h-full items-center justify-center bg-bg text-xs text-text-secondary"
      >
        Resolving runtime mode…
      </div>
    )
  }

  if (mode === 'interactive') {
    return <InteractivePanel key={`int-${task.id}`} {...props} />
  }

  return <HeadlessPanel key={`head-${task.id}`} {...props} />
}

// ─── Headless panel (existing behavior) ──────────────────────────────────

function HeadlessPanel({ task, onClose }: AgentPanelProps) {
  const workspace = useWorkspaceStore((s) =>
    s.workspaces.find((w) => w.id === task.workspaceId)
  )
  const workingDir = task.worktreePath ?? workspace?.repoPath ?? ''
  const session = useAgentPanelSession(task)
  const {
    changes,
    loading,
    diffByFile,
    diffLoading,
    diffError,
    commits,
    loadDiff,
  } = useTaskDetail(task)
  const transcriptState = useAgentTranscriptStore((s) => s.getTaskState(task.id))
  const loadTranscript = useAgentTranscriptStore((s) => s.load)
  const subscribeTranscript = useAgentTranscriptStore((s) => s.subscribe)
  const unsubscribeTranscript = useAgentTranscriptStore((s) => s.unsubscribe)
  const [activeView, setActiveView] = useState<PanelView>('activity')
  const [stopBusy, setStopBusy] = useState(false)
  const [holdBusy, setHoldBusy] = useState(false)
  const [killBusy, setKillBusy] = useState(false)
  const [draftInsertion, setDraftInsertion] = useState<{ id: number; content: string } | null>(null)

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

  const handleSendDiffToAgent = useCallback((content: string) => {
    const trimmed = content.trim()
    if (!trimmed) return
    setDraftInsertion({
      id: Date.now(),
      content: [
        'Selected diff context:',
        '',
        '```diff',
        trimmed,
        '```',
      ].join('\n'),
    })
    setActiveView('activity')
  }, [])

  return (
    <div data-testid="agent-panel" className="flex h-full flex-col">
      <PanelHeader
        onClose={onClose}
        rightSlot={
          <>
            <button
              type="button"
              onClick={() => { void handleHoldToggle() }}
              disabled={holdBusy}
              data-testid="agent-panel-hold-button"
              title={task.heldByUser ? 'Release auto-advance hold' : 'Hold auto-advance for this task'}
              className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium transition-colors disabled:opacity-50 ${
                task.heldByUser
                  ? 'border-warning/40 bg-warning/10 text-warning'
                  : 'border-border-default bg-surface text-text-secondary hover:bg-surface-hover hover:text-text-primary'
              }`}
              style={{ cursor: holdBusy ? 'wait' : 'pointer' }}
            >
              <HoldIcon />
              {task.heldByUser ? 'Held' : 'Hold'}
            </button>
            <PanelOverflowMenu
              killBusy={killBusy}
              onKill={() => { void handleKill() }}
            />
          </>
        }
        viewSlot={
          <div className="inline-flex min-w-0 shrink-0 items-center gap-1">
            <ViewButton
              active={activeView === 'activity'}
              onClick={() => { setActiveView('activity') }}
              testId="agent-panel-tab-transcript"
            >
              Activity
            </ViewButton>
            <ViewButton
              active={activeView === 'terminal'}
              onClick={() => { setActiveView('terminal') }}
              testId="agent-panel-tab-terminal"
            >
              Terminal
            </ViewButton>
            <ViewButton
              active={activeView === 'changes'}
              onClick={() => { setActiveView('changes') }}
              testId="agent-panel-tab-changes"
            >
              Changes
            </ViewButton>
          </div>
        }
        errorSlot={
          session.error ? (
            <button
              type="button"
              onClick={session.clearDisplayedError}
              className="truncate text-[11px] text-error hover:text-error/80"
              title={session.error}
            >
              {session.error}
            </button>
          ) : null
        }
      />

      <div className="relative min-h-0 flex-1">
        {activeView === 'activity' ? (
          <div className="flex h-full flex-col">
            <AgentTranscript
              events={transcriptState.events}
              isLoading={session.chat.isLoading || transcriptState.isLoading}
              processingStartTime={session.chat.streaming.startTime}
              queuedMessages={session.chat.queue}
              onCancel={() => {
                if (isAgentRunning) {
                  void handleStop()
                } else {
                  void session.chat.cancel()
                }
              }}
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
              draftInsertion={draftInsertion}
              deliveryHint={inputDelivery}
              submitLabel={submitLabel}
              isProcessing={session.chat.streaming.isStreaming || isAgentRunning}
              disabled={!session.chat.canSend || session.cliDetecting}
              queueCount={session.chat.queue.length}
            />
          </div>
        ) : activeView === 'terminal' ? (
          <TerminalView taskId={task.id} workingDir={workingDir} />
        ) : (
          <div className="h-full overflow-auto bg-bg p-2" data-testid="agent-panel-changes-view">
            <div className="space-y-2">
              <DiffSection
                branch={task.branch ?? null}
                changes={changes}
                loading={loading}
                diffLoading={diffLoading}
                diffError={diffError}
                diffByFile={diffByFile}
                loadDiff={loadDiff}
                compact
                maxDiffHeight="none"
                onSendToAgent={handleSendDiffToAgent}
              />
              <div className="rounded-md border border-border-default bg-surface" data-testid="agent-panel-commits">
                <div className="border-b border-border-default px-3 py-2">
                  <h3 className="text-xs font-medium text-text-primary">Commits</h3>
                </div>
                <CommitsSection commits={commits} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Interactive panel (Phase 2) ────────────────────────────────────────

function InteractivePanel({ task, onClose }: AgentPanelProps) {
  const workspace = useWorkspaceStore((s) =>
    s.workspaces.find((w) => w.id === task.workspaceId)
  )
  const workingDir = task.worktreePath ?? workspace?.repoPath ?? ''
  const [injecting, setInjecting] = useState(false)
  const [injectError, setInjectError] = useState<string | null>(null)
  const [killBusy, setKillBusy] = useState(false)
  const [holdBusy, setHoldBusy] = useState(false)

  const handleSend = useCallback(async (message: ChatInputMessage) => {
    const content = message.content.trim()
    if (!content) return
    setInjecting(true)
    setInjectError(null)
    try {
      await agentInjectMessage(task.id, content)
    } catch (err) {
      setInjectError(err instanceof Error ? err.message : String(err))
    } finally {
      window.setTimeout(() => { setInjecting(false) }, 200)
    }
  }, [task.id])

  const handleHoldToggle = async () => {
    if (holdBusy) return
    setHoldBusy(true)
    try {
      await holdTask(task.id, !task.heldByUser)
    } catch (err) {
      console.warn(`[agent-panel:interactive] hold toggle failed for ${task.id}:`, err)
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
      console.warn(`[agent-panel:interactive] kill session failed for ${task.id}:`, err)
    } finally {
      setKillBusy(false)
    }
  }

  return (
    <div data-testid="agent-panel" data-mode="interactive" className="flex h-full flex-col">
      <PanelHeader
        onClose={onClose}
        rightSlot={
          <>
            <button
              type="button"
              onClick={() => { void handleHoldToggle() }}
              disabled={holdBusy}
              data-testid="agent-panel-hold-button"
              title={task.heldByUser ? 'Release auto-advance hold' : 'Hold auto-advance for this task'}
              className={`inline-flex h-7 items-center gap-1.5 rounded-md border px-2 text-[11px] font-medium transition-colors disabled:opacity-50 ${
                task.heldByUser
                  ? 'border-warning/40 bg-warning/10 text-warning'
                  : 'border-border-default bg-surface text-text-secondary hover:bg-surface-hover hover:text-text-primary'
              }`}
              style={{ cursor: holdBusy ? 'wait' : 'pointer' }}
            >
              <HoldIcon />
              {task.heldByUser ? 'Held' : 'Hold'}
            </button>
            <PanelOverflowMenu
              killBusy={killBusy}
              onKill={() => { void handleKill() }}
            />
          </>
        }
        errorSlot={
          injectError ? (
            <button
              type="button"
              onClick={() => { setInjectError(null) }}
              className="truncate text-[11px] text-error hover:text-error/80"
              title={injectError}
            >
              {injectError}
            </button>
          ) : null
        }
      />

      <div className="relative flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1">
          <InteractiveAgentView
            taskId={task.id}
            workingDir={workingDir}
            agentStatus={task.agentStatus}
            agentPausedAt={task.agentPausedAt}
          />
        </div>
        <ChatInput
          config={{
            placeholder: 'Message Claude…',
            showModelSelector: false,
            showThinkingSelector: false,
            showVoiceInput: false,
            showAttachments: false,
            rows: 1,
          }}
          onSend={(message) => { void handleSend(message) }}
          deliveryHint="Interactive · sends a literal line to the live agent"
          submitLabel="Send"
          isProcessing={injecting}
          disabled={injecting}
        />
      </div>
    </div>
  )
}

// ─── Shared header ───────────────────────────────────────────────────────

type PanelHeaderProps = {
  onClose?: () => void
  rightSlot?: ReactNode
  viewSlot?: ReactNode
  errorSlot?: ReactNode
}

function PanelHeader({
  onClose,
  rightSlot,
  viewSlot,
  errorSlot,
}: PanelHeaderProps) {
  return (
    <div className="border-b border-border-default bg-bg">
      <div className="flex min-w-0 items-center gap-2 px-3 py-2">
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-transparent text-text-secondary transition-colors hover:border-border-default hover:bg-surface-hover hover:text-text-primary"
              title="Close panel (Esc)"
              aria-label="Close panel"
              style={{ cursor: 'pointer' }}
            >
              <svg
                width="15"
                height="15"
                viewBox="0 0 15 15"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M5.25 3.75 9 7.5l-3.75 3.75" />
              </svg>
            </button>
          )}

          <div className="min-w-0 flex-1">{viewSlot}</div>

          <div className="inline-flex shrink-0 items-center gap-1 text-xs">
            {rightSlot}
          </div>
      </div>

      {errorSlot && <div className="px-3 pb-2">{errorSlot}</div>}
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
      className={`relative inline-flex min-w-0 items-center gap-1.5 px-2 py-1.5 text-[11px] font-medium transition-colors ${
        active
          ? 'text-text-primary'
          : 'text-text-secondary hover:text-text-primary'
      }`}
      style={{ cursor: 'pointer' }}
    >
      <span className="truncate">{children}</span>
      {active && (
        <span className="absolute inset-x-2 bottom-0 h-px rounded-full bg-accent" aria-hidden="true" />
      )}
    </button>
  )
}

function HoldIcon() {
  return (
    <svg className="h-3 w-3" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M5.25 2.5A1.75 1.75 0 0 0 3.5 4.25v7.5a1.75 1.75 0 0 0 3.5 0v-7.5A1.75 1.75 0 0 0 5.25 2.5Zm5.5 0A1.75 1.75 0 0 0 9 4.25v7.5a1.75 1.75 0 0 0 3.5 0v-7.5a1.75 1.75 0 0 0-1.75-1.75Z" />
    </svg>
  )
}

function PanelOverflowMenu({
  killBusy,
  onKill,
}: {
  killBusy: boolean
  onKill: () => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => { setOpen((current) => !current) }}
        aria-expanded={open}
        aria-label="Agent actions"
        title="Agent actions"
        className="flex h-7 w-7 items-center justify-center rounded-md border border-border-default bg-surface text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary"
        style={{ cursor: 'pointer' }}
      >
        <svg className="h-3.5 w-3.5" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
          <path d="M4 8a1.25 1.25 0 1 1-2.5 0A1.25 1.25 0 0 1 4 8Zm5.25 0a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0ZM13.25 9.25a1.25 1.25 0 1 0 0-2.5 1.25 1.25 0 0 0 0 2.5Z" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-36 rounded-md border border-border-default bg-bg p-1 shadow-lg">
          <button
            type="button"
            onClick={() => {
              setOpen(false)
              onKill()
            }}
            disabled={killBusy}
            data-testid="agent-panel-kill-button"
            className="flex w-full items-center rounded px-2 py-1.5 text-left text-[11px] font-medium text-error hover:bg-error/10 disabled:opacity-50"
            style={{ cursor: killBusy ? 'wait' : 'pointer' }}
          >
            Kill session
          </button>
        </div>
      )}
    </div>
  )
}
