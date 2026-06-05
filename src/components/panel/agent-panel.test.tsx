import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { invoke } from '@tauri-apps/api/core'
import type { Task } from '@/types'
import { mockKanbanTask } from '@/test/mocks/tauri'
import { AgentPanel } from './agent-panel'
import { holdTask, killTaskSession } from '@/lib/ipc/agent'
import { useAgentPanelSession } from './use-agent-panel-session'

const sendMessageMock = vi.fn()
const cancelMock = vi.fn()
const mockInvoke = vi.mocked(invoke)

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

vi.mock('@/lib/ipc/agent-interactive', () => ({
  agentInjectMessage: vi.fn().mockResolvedValue(undefined),
  agentInterrupt: vi.fn().mockResolvedValue(undefined),
  agentSwitchModel: vi.fn().mockResolvedValue(undefined),
  agentRestart: vi.fn().mockResolvedValue(undefined),
  resolveRuntimeMode: vi.fn().mockResolvedValue({
    mode: 'headless',
    render: 'bubbles',
    source: 'default',
    interactiveDevFlagRequired: false,
  }),
  interactiveModeDevFlag: vi.fn().mockResolvedValue(false),
}))

vi.mock('@/hooks/use-resolved-runtime-mode', () => ({
  useResolvedRuntimeMode: vi.fn().mockReturnValue({
    mode: 'headless',
    render: 'bubbles',
    source: 'default',
    interactiveDevFlagRequired: false,
    isLoading: false,
    error: null,
  }),
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

vi.mock('./interactive-agent-view', () => ({
  InteractiveAgentView: ({ taskId }: { taskId: string }) => (
    <div data-testid="interactive-agent-view" data-task-id={taskId} />
  ),
}))

vi.mock('./use-agent-panel-session', () => ({
  useAgentPanelSession: vi.fn(),
}))

vi.mock('./shared', () => ({
  ChatInput: ({
    onSend,
    onCancel,
    disabled,
    isProcessing,
    deliveryHint,
    submitLabel,
    draftInsertion,
  }: {
    onSend: (message: { content: string; model: 'claude-opus-4-7' }) => void
    onCancel?: () => void
    disabled?: boolean
    isProcessing?: boolean
    deliveryHint?: string
    submitLabel?: string
    draftInsertion?: { id: number; content: string } | null
  }) => (
    <div
      data-testid="chat-input"
      data-disabled={String(!!disabled)}
      data-processing={String(!!isProcessing)}
      data-delivery-hint={deliveryHint}
      data-submit-label={submitLabel}
      data-draft={draftInsertion?.content ?? ''}
    >
      <button
        type="button"
        onClick={() => { onSend({ content: 'hello agent', model: 'claude-opus-4-7' }) }}
      >
        Send transcript message
      </button>
      {isProcessing && onCancel && (
        <button
          type="button"
          onClick={() => { onCancel() }}
        >
          Stop agent
        </button>
      )}
    </div>
  ),
  ToolCallItem: ({ toolCall }: { toolCall: { toolName: string } }) => (
    <div data-testid="tool-call">{toolCall.toolName}</div>
  ),
}))

vi.mock('./terminal-view', () => ({
  TerminalView: ({
    taskId,
    workingDir,
    allowSpawn,
  }: {
    taskId: string
    workingDir: string
    allowSpawn?: boolean
  }) => (
    <div
      data-testid="terminal-view"
      data-task-id={taskId}
      data-working-dir={workingDir}
      data-allow-spawn={String(!!allowSpawn)}
    />
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
  return render(<AgentPanel task={mockKanbanTask(overrides)} />)
}

describe('AgentPanel session controls', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'get_changes') {
        return Promise.resolve({ files: [], totalAdditions: 0, totalDeletions: 0, totalFiles: 0 })
      }
      if (cmd === 'get_commits') {
        return Promise.resolve([
          {
            hash: 'abc123',
            shortHash: 'abc123',
            message: 'Keep commits visible in the changes panel',
            author: 'Agent',
            timestamp: 1,
          },
        ])
      }
      if (cmd === 'get_diff') return Promise.resolve('')
      return Promise.reject(new Error(`Unmocked command: ${cmd}`))
    })
    mockPanelSession()
  })

  it('opens to activity by default', () => {
    renderPanel()

    expect(screen.getByTestId('agent-transcript')).toBeInTheDocument()
    expect(screen.queryByTestId('agent-panel-changes-view')).not.toBeInTheDocument()
    expect(screen.queryByTestId('terminal-view')).not.toBeInTheDocument()
  })

  it('switches to the raw terminal tab without losing task session wiring', () => {
    renderPanel({ agentStatus: 'running', worktreePath: '/tmp/worktree' })

    fireEvent.click(screen.getByRole('button', { name: 'Terminal' }))

    const terminal = screen.getByTestId('terminal-view')
    expect(terminal).toHaveAttribute('data-task-id', 't1')
    expect(terminal).toHaveAttribute('data-working-dir', '/tmp/worktree')
    expect(terminal).toHaveAttribute('data-allow-spawn', 'true')
  })

  it('does not spawn a terminal session for stopped tasks', () => {
    renderPanel({ agentStatus: 'completed', worktreePath: '/tmp/worktree' })

    fireEvent.click(screen.getByRole('button', { name: 'Terminal' }))

    expect(screen.getByTestId('terminal-view')).toHaveAttribute('data-allow-spawn', 'false')
  })

  it('shows Activity, Terminal, and Changes tabs in headless mode without tab badges', () => {
    renderPanel()

    // Icon-only tabs in the header; their accessible name comes from aria-label.
    const tabs = [
      screen.getByRole('button', { name: 'Activity' }),
      screen.getByRole('button', { name: 'Terminal' }),
      screen.getByRole('button', { name: 'Changes' }),
    ]
    expect(tabs.map((tab) => tab.getAttribute('aria-label'))).toEqual(['Activity', 'Terminal', 'Changes'])
    expect(screen.queryByRole('button', { name: 'Context' })).not.toBeInTheDocument()
    expect(screen.queryByText('live')).not.toBeInTheDocument()
    expect(screen.queryByText(/\+\d+/)).not.toBeInTheDocument()
  })

  it('loads branch changes in the Changes tab and fetches file diffs', async () => {
    mockInvoke.mockImplementation((cmd, args) => {
      if (cmd === 'get_changes') {
        return Promise.resolve({
          files: [{ path: 'src/app.ts', status: 'modified', additions: 2, deletions: 1 }],
          totalAdditions: 2,
          totalDeletions: 1,
          totalFiles: 1,
        })
      }
      if (cmd === 'get_commits') {
        return Promise.resolve([
          {
            hash: 'abc123',
            shortHash: 'abc123',
            message: 'Keep commits visible in the changes panel',
            author: 'Agent',
            timestamp: 1,
          },
        ])
      }
      if (cmd === 'get_diff') {
        expect(args).toMatchObject({
          repoPath: '/tmp/ws',
          branch: 'task/test',
          filePath: 'src/app.ts',
        })
        return Promise.resolve('diff --git a/src/app.ts b/src/app.ts\n@@ -1 +1 @@\n-old\n+new')
      }
      return Promise.reject(new Error(`Unmocked command: ${cmd}`))
    })

    renderPanel({ branch: 'task/test' })
    fireEvent.click(screen.getByTestId('agent-panel-tab-changes'))

    await waitFor(() => {
      expect(screen.getByTestId('changes-panel')).toBeInTheDocument()
      expect(screen.getByTestId('agent-panel-commits')).toBeInTheDocument()
      expect(screen.getByText('src/app.ts')).toBeInTheDocument()
      expect(screen.getByText('Keep commits visible in the changes panel')).toBeInTheDocument()
    })

    fireEvent.click(screen.getByText('src/app.ts').closest('button') as HTMLButtonElement)

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('get_diff', {
        repoPath: '/tmp/ws',
        branch: 'task/test',
        filePath: 'src/app.ts',
      })
    })
  })

  it('loads the combined diff from View all', async () => {
    mockInvoke.mockImplementation((cmd, args) => {
      if (cmd === 'get_changes') {
        return Promise.resolve({
          files: [{ path: 'src/app.ts', status: 'modified', additions: 1, deletions: 0 }],
          totalAdditions: 1,
          totalDeletions: 0,
          totalFiles: 1,
        })
      }
      if (cmd === 'get_commits') return Promise.resolve([])
      if (cmd === 'get_diff') {
        expect(args).toMatchObject({ repoPath: '/tmp/ws', branch: 'task/test' })
        return Promise.resolve('diff --git a/src/app.ts b/src/app.ts\n@@ -1,0 +1 @@\n+new')
      }
      return Promise.reject(new Error(`Unmocked command: ${cmd}`))
    })

    renderPanel({ branch: 'task/test' })
    fireEvent.click(screen.getByTestId('agent-panel-tab-changes'))
    await screen.findByText('src/app.ts')

    fireEvent.click(screen.getByRole('button', { name: 'View all' }))

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('get_diff', {
        repoPath: '/tmp/ws',
        branch: 'task/test',
        filePath: undefined,
      })
    })
  })

  it('adds sent diff snippets to the transcript composer draft', async () => {
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'get_changes') {
        return Promise.resolve({
          files: [{ path: 'src/app.ts', status: 'modified', additions: 1, deletions: 1 }],
          totalAdditions: 1,
          totalDeletions: 1,
          totalFiles: 1,
        })
      }
      if (cmd === 'get_commits') return Promise.resolve([])
      if (cmd === 'get_diff') {
        return Promise.resolve('diff --git a/src/app.ts b/src/app.ts\n@@ -1 +1 @@\n-old\n+new')
      }
      return Promise.reject(new Error(`Unmocked command: ${cmd}`))
    })

    renderPanel({ branch: 'task/test' })
    fireEvent.click(screen.getByTestId('agent-panel-tab-changes'))
    await screen.findByText('src/app.ts')
    fireEvent.click(screen.getByText('src/app.ts').closest('button') as HTMLButtonElement)
    await screen.findByText('Send')

    fireEvent.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => {
      expect(screen.getByTestId('agent-transcript')).toBeInTheDocument()
      const draft = screen.getByTestId('chat-input').getAttribute('data-draft') ?? ''
      expect(draft).toContain('Selected diff context:')
      expect(draft).toContain('+new')
    })
  })

  it('sends transcript composer messages through the agent panel session', async () => {
    renderPanel()

    fireEvent.click(screen.getByRole('button', { name: 'Activity' }))
    fireEvent.click(screen.getByRole('button', { name: 'Send transcript message' }))

    await waitFor(() => {
      expect(sendMessageMock).toHaveBeenCalledWith({ content: 'hello agent', model: 'claude-opus-4-7' })
    })
  })

  it('marks the composer as processing when the task is running even after reload', () => {
    renderPanel({ agentStatus: 'running', agentMode: 'managed' })

    fireEvent.click(screen.getByRole('button', { name: 'Activity' }))
    const input = screen.getByTestId('chat-input')
    expect(input).toHaveAttribute('data-processing', 'true')
    expect(input).toHaveAttribute('data-delivery-hint', 'Running · message will queue for the next managed turn')
    expect(input).toHaveAttribute('data-submit-label', 'Queue next turn')
  })

  it('moves Stop to the composer while running', () => {
    const idle = renderPanel({ agentStatus: 'idle' })

    expect(screen.queryByRole('button', { name: 'Stop agent' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('agent-panel-stop-button')).not.toBeInTheDocument()
    idle.unmount()

    renderPanel({ agentStatus: 'running' })
    fireEvent.click(screen.getByRole('button', { name: 'Activity' }))
    expect(screen.getByRole('button', { name: 'Stop agent' })).toBeInTheDocument()
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

    fireEvent.click(screen.getByRole('button', { name: 'Agent actions' }))
    fireEvent.click(screen.getByRole('button', { name: 'Kill session' }))

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalled()
      expect(killTaskSession).toHaveBeenCalledWith('t1')
    })
  })
})

// ─── Phase 2: mode dispatcher ──────────────────────────────────────────────

import { useResolvedRuntimeMode } from '@/hooks/use-resolved-runtime-mode'
import { agentInjectMessage } from '@/lib/ipc/agent-interactive'

describe('AgentPanel mode dispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPanelSession()
  })

  it('renders the loading skeleton while the mode resolves', () => {
    vi.mocked(useResolvedRuntimeMode).mockReturnValue({
      mode: 'headless',
      render: 'bubbles',
      source: 'default',
      interactiveDevFlagRequired: false,
      isLoading: true,
      error: null,
    })
    renderPanel()
    expect(screen.getByTestId('agent-panel-loading')).toBeInTheDocument()
  })

  it('renders the interactive view + control bar when mode resolves to interactive', () => {
    vi.mocked(useResolvedRuntimeMode).mockReturnValue({
      mode: 'interactive',
      render: null,
      source: 'trigger',
      interactiveDevFlagRequired: false,
      isLoading: false,
      error: null,
    })
    renderPanel()
    expect(screen.getByTestId('interactive-agent-view')).toBeInTheDocument()
    // Headless transcript view must NOT render in interactive mode.
    expect(screen.queryByTestId('agent-transcript')).not.toBeInTheDocument()
  })

  it('routes chat input through agent_inject_message in interactive mode', async () => {
    vi.mocked(useResolvedRuntimeMode).mockReturnValue({
      mode: 'interactive',
      render: null,
      source: 'trigger',
      interactiveDevFlagRequired: false,
      isLoading: false,
      error: null,
    })
    renderPanel()
    fireEvent.click(screen.getByRole('button', { name: 'Send transcript message' }))
    await waitFor(() => {
      expect(vi.mocked(agentInjectMessage)).toHaveBeenCalledWith('t1', 'hello agent')
    })
    // The headless chat-session send path must NOT fire.
    expect(sendMessageMock).not.toHaveBeenCalled()
  })

  it('falls back to headless dispatcher when mode is headless', () => {
    vi.mocked(useResolvedRuntimeMode).mockReturnValue({
      mode: 'headless',
      render: 'bubbles',
      source: 'default',
      interactiveDevFlagRequired: false,
      isLoading: false,
      error: null,
    })
    renderPanel()
    expect(screen.getByTestId('agent-transcript')).toBeInTheDocument()
    expect(screen.queryByTestId('interactive-agent-view')).not.toBeInTheDocument()
  })
})
