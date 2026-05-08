import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import type { Task } from '@/types'
import { mockKanbanTask } from '@/test/mocks/tauri'
import { AgentPanel } from './agent-panel'
import { holdTask, killTaskSession } from '@/lib/ipc/agent'
import { signalPtyInterrupt } from '@/lib/ipc/terminal'
import { useAgentPanelSession } from './use-agent-panel-session'

const sendMessageMock = vi.fn()
const cancelMock = vi.fn()

vi.mock('@/stores/workspace-store', () => ({
  useWorkspaceStore: (selector: (state: { workspaces: Array<{ id: string; repoPath: string }> }) => unknown) =>
    selector({ workspaces: [{ id: 'ws-1', repoPath: '/tmp/ws' }] }),
}))

vi.mock('@/stores/agent-transcript-store', () => ({
  useAgentTranscriptStore: (selector: (state: {
    getTaskState: (taskId: string) => {
      events: Array<{
        id: string
        taskId: string
        sessionId: string | null
        eventType: 'user_input'
        content: string
        metadataJson: string | null
        sequence: number
        createdAt: string
      }>
      isLoading: boolean
      error: string | null
    }
    load: (taskId: string) => Promise<void>
    subscribe: (taskId: string) => Promise<void>
    unsubscribe: () => void
  }) => unknown) =>
    selector({
      getTaskState: (taskId: string) => ({
        events: [{
          id: 'e1',
          taskId,
          sessionId: null,
          eventType: 'user_input',
          content: 'Just a test',
          metadataJson: null,
          sequence: 1,
          createdAt: '2026-05-07T06:00:00Z',
        }],
        isLoading: false,
        error: null,
      }),
      load: vi.fn().mockResolvedValue(undefined),
      subscribe: vi.fn().mockResolvedValue(undefined),
      unsubscribe: vi.fn(),
    }),
}))

vi.mock('@/lib/ipc/agent', () => ({
  holdTask: vi.fn().mockResolvedValue(undefined),
  killTaskSession: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/ipc/terminal', () => ({
  getPtyScrollback: vi.fn().mockResolvedValue(''),
  signalPtyInterrupt: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/ipc', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  getAgentTranscriptEvents: vi.fn().mockResolvedValue([]),
  onAgentTranscriptEvent: vi.fn().mockResolvedValue(() => {}),
}))

vi.mock('./use-agent-panel-session', () => ({
  useAgentPanelSession: vi.fn(),
}))

vi.mock('./shared', () => ({
  ChatInput: ({
    onSend,
    disabled,
    isProcessing,
    deliveryHint,
    submitLabel,
  }: {
    onSend: (message: { content: string; model: 'claude-opus-4-7' }) => void
    disabled?: boolean
    isProcessing?: boolean
    deliveryHint?: string
    submitLabel?: string
  }) => (
    <div
      data-testid="chat-input"
      data-disabled={String(!!disabled)}
      data-processing={String(!!isProcessing)}
      data-delivery-hint={deliveryHint}
      data-submit-label={submitLabel}
    >
      <button
        type="button"
        onClick={() => { onSend({ content: 'hello agent', model: 'claude-opus-4-7' }) }}
      >
        Send transcript message
      </button>
    </div>
  ),
  ToolCallItem: ({ toolCall }: { toolCall: { toolName: string } }) => (
    <div data-testid="tool-call">{toolCall.toolName}</div>
  ),
}))

vi.mock('./terminal-view', () => ({
  TerminalView: ({ taskId, workingDir }: { taskId: string; workingDir: string }) => (
    <div data-testid="terminal-view" data-task-id={taskId} data-working-dir={workingDir} />
  ),
}))

function mockPanelSession(overrides: Partial<ReturnType<typeof defaultPanelSession>> = {}) {
  vi.mocked(useAgentPanelSession).mockReturnValue({
    ...defaultPanelSession(),
    ...overrides,
  })
}

function defaultPanelSession() {
  return {
    chat: {
      messages: [],
      isLoading: false,
      streaming: {
        isStreaming: false,
        content: '',
        thinkingContent: '',
        toolCalls: [],
        startTime: null,
      },
      error: null,
      queue: [],
      failedMessage: null,
      canSend: true,
      sendMessage: sendMessageMock,
      cancel: cancelMock,
      clearMessages: vi.fn(),
      refreshMessages: vi.fn(),
      clearError: vi.fn(),
      retryFailed: vi.fn(),
      dismissFailed: vi.fn(),
      clearQueue: vi.fn(),
    },
    cliDetecting: false,
    error: null,
    chatMessages: [
      {
        id: 'm1',
        workspaceId: 'ws-1',
        sessionId: 't1',
        role: 'user' as const,
        content: 'Just a test',
        createdAt: '2026-05-07T06:00:00Z',
      },
    ],
    toolCalls: [],
    handleAttachmentError: vi.fn(),
    handleClearHistory: vi.fn(),
    handleInputChange: vi.fn(),
    handleSendMessage: sendMessageMock,
    clearDisplayedError: vi.fn(),
  }
}

function renderPanel(overrides: Partial<Task> = {}) {
  render(<AgentPanel task={mockKanbanTask(overrides)} />)
}

describe('AgentPanel session controls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPanelSession()
  })

  it('opens to the terminal Markdown transcript by default', () => {
    renderPanel()

    expect(screen.getByTestId('agent-transcript')).toBeInTheDocument()
    expect(screen.getByText('Just a test')).toBeInTheDocument()
    expect(screen.queryByTestId('terminal-view')).not.toBeInTheDocument()
  })

  it('switches to the raw terminal tab without losing task session wiring', () => {
    renderPanel({ worktreePath: '/tmp/worktree' })

    fireEvent.click(screen.getByRole('button', { name: 'Terminal' }))

    const terminal = screen.getByTestId('terminal-view')
    expect(terminal).toHaveAttribute('data-task-id', 't1')
    expect(terminal).toHaveAttribute('data-working-dir', '/tmp/worktree')
  })

  it('sends transcript composer messages through the agent panel session', async () => {
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Send transcript message' }))

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith({ content: 'hello agent', model: 'claude-opus-4-7' })
    })
  })

  it('marks the composer as processing when the task is running even after reload', () => {
    renderPanel({ agentStatus: 'running', agentMode: 'managed' })

    const input = screen.getByTestId('chat-input')
    expect(input).toHaveAttribute('data-processing', 'true')
    expect(input).toHaveAttribute('data-delivery-hint', 'Running · message will queue for the next managed turn')
    expect(input).toHaveAttribute('data-submit-label', 'Queue next turn')
  })

  it('disables Stop while idle and sends Ctrl+C while running', async () => {
    renderPanel({ agentStatus: 'idle' })

    expect(screen.getByRole('button', { name: 'Stop' })).toBeDisabled()

    render(<AgentPanel task={mockKanbanTask({ agentStatus: 'running' })} />)
    const runningStop = screen.getAllByRole('button', { name: 'Stop' }).at(1)
    expect(runningStop).toBeDefined()
    fireEvent.click(runningStop as HTMLElement)

    await waitFor(() => {
      expect(signalPtyInterrupt).toHaveBeenCalledWith('t1')
    })
  })

  it('toggles hold through the shared task hold IPC', async () => {
    renderPanel({ heldByUser: false })

    fireEvent.click(screen.getByRole('button', { name: 'Hold' }))

    await waitFor(() => {
      expect(holdTask).toHaveBeenCalledWith('t1', true)
    })
  })

  it('requires confirmation before killing the task session', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Kill' }))

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalled()
      expect(killTaskSession).toHaveBeenCalledWith('t1')
    })
  })
})
