import { describe, it, expect, vi, beforeEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { InteractiveAgentView } from './interactive-agent-view'

const interactiveMocks = vi.hoisted(() => ({
  agentInterrupt: vi.fn().mockResolvedValue(undefined),
  agentRestart: vi.fn().mockResolvedValue(undefined),
  agentSwitchModel: vi.fn().mockResolvedValue(undefined),
  agentPause: vi.fn().mockResolvedValue(undefined),
  agentResume: vi.fn().mockResolvedValue(undefined),
  agentAdvance: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/ipc/agent-interactive', () => ({
  agentInterrupt: interactiveMocks.agentInterrupt,
  agentRestart: interactiveMocks.agentRestart,
  agentSwitchModel: interactiveMocks.agentSwitchModel,
  agentPause: interactiveMocks.agentPause,
  agentResume: interactiveMocks.agentResume,
  agentAdvance: interactiveMocks.agentAdvance,
}))

// Capture event listeners by channel so tests can fire backend events.
const listenHandlers = vi.hoisted(() => new Map<string, (e: { payload: unknown }) => void>())
vi.mock('@/lib/ipc', () => ({
  listen: vi.fn((channel: string, handler: (e: { payload: unknown }) => void) => {
    listenHandlers.set(channel, handler)
    return Promise.resolve(() => { listenHandlers.delete(channel) })
  }),
}))

function fireInteractiveDone(taskId: string) {
  listenHandlers.get(`agent:${taskId}:interactive_done`)?.({ payload: taskId })
}

vi.mock('./terminal-view', () => ({
  TerminalView: ({
    taskId,
    allowSpawn,
  }: {
    taskId: string
    allowSpawn?: boolean
  }) => (
    <div
      data-testid="terminal-view"
      data-task-id={taskId}
      data-allow-spawn={String(!!allowSpawn)}
    />
  ),
}))

describe('InteractiveAgentView', () => {
  beforeEach(() => {
    interactiveMocks.agentInterrupt.mockClear()
    interactiveMocks.agentRestart.mockClear()
    interactiveMocks.agentSwitchModel.mockClear()
    interactiveMocks.agentPause.mockClear()
    interactiveMocks.agentResume.mockClear()
    interactiveMocks.agentAdvance.mockClear()
    listenHandlers.clear()
    // Auto-confirm restart dialog.
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  it('surfaces an advisory Advance affordance on interactive_done and calls agentAdvance', async () => {
    render(
      <InteractiveAgentView taskId="task-1" workingDir="/tmp" agentStatus="idle" />,
    )
    // No banner until the agent signals done.
    expect(screen.queryByTestId('interactive-agent-done-banner')).not.toBeInTheDocument()

    act(() => { fireInteractiveDone('task-1') })

    const banner = await screen.findByTestId('interactive-agent-done-banner')
    expect(banner).toBeInTheDocument()
    // It's advisory — advancing must NOT have happened automatically.
    expect(interactiveMocks.agentAdvance).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('interactive-agent-advance'))
    await waitFor(() => {
      expect(interactiveMocks.agentAdvance).toHaveBeenCalledWith('task-1')
    })
  })

  it('renders control bar with status pill and terminal view', () => {
    render(
      <InteractiveAgentView
        taskId="task-1"
        workingDir="/tmp"
        agentStatus="running"
      />,
    )
    expect(screen.getByTestId('interactive-agent-control-bar')).toBeInTheDocument()
    expect(screen.getByTestId('interactive-agent-status')).toBeInTheDocument()
    expect(screen.getByTestId('terminal-view').getAttribute('data-task-id')).toBe('task-1')
    expect(screen.getByTestId('terminal-view')).toHaveAttribute('data-allow-spawn', 'true')
  })

  it('Interrupt button calls agentInterrupt', async () => {
    render(
      <InteractiveAgentView
        taskId="task-1"
        workingDir="/tmp"
        agentStatus="running"
      />,
    )
    fireEvent.click(screen.getByTestId('interactive-agent-interrupt'))
    await waitFor(() => {
      expect(interactiveMocks.agentInterrupt).toHaveBeenCalledWith('task-1')
    })
  })

  it('Restart button confirms then calls agentRestart', async () => {
    render(
      <InteractiveAgentView
        taskId="task-1"
        workingDir="/tmp"
        agentStatus="running"
      />,
    )
    fireEvent.click(screen.getByTestId('interactive-agent-restart'))
    await waitFor(() => {
      expect(interactiveMocks.agentRestart).toHaveBeenCalledWith('task-1')
    })
  })

  it('shows backend errors when a control fails', async () => {
    interactiveMocks.agentInterrupt.mockRejectedValueOnce(new Error('no tmux session'))
    render(
      <InteractiveAgentView
        taskId="task-1"
        workingDir="/tmp"
        agentStatus="running"
      />,
    )
    fireEvent.click(screen.getByTestId('interactive-agent-interrupt'))
    await waitFor(() => {
      expect(screen.getByTestId('interactive-agent-view-error')).toHaveTextContent('no tmux session')
    })
  })

  it('shows Stopped pill when agent has completed', () => {
    render(
      <InteractiveAgentView
        taskId="task-1"
        workingDir="/tmp"
        agentStatus="completed"
      />,
    )
    expect(screen.getByTestId('interactive-agent-status')).toHaveTextContent(/Stopped/)
    expect(screen.getByTestId('terminal-view')).toHaveAttribute('data-allow-spawn', 'false')
  })

  // ─── Phase 5: pause / resume ────────────────────────────────────────

  it('renders Pause label and calls agentPause when not paused', async () => {
    render(
      <InteractiveAgentView
        taskId="task-1"
        workingDir="/tmp"
        agentStatus="running"
        agentPausedAt={null}
      />,
    )
    const btn = screen.getByTestId('interactive-agent-pause')
    expect(btn).toHaveTextContent(/Pause/)
    fireEvent.click(btn)
    await waitFor(() => {
      expect(interactiveMocks.agentPause).toHaveBeenCalledWith('task-1')
    })
    expect(interactiveMocks.agentResume).not.toHaveBeenCalled()
  })

  it('renders Resume label and shows paused status when agentPausedAt is set', async () => {
    render(
      <InteractiveAgentView
        taskId="task-1"
        workingDir="/tmp"
        agentStatus="running"
        agentPausedAt={Date.now()}
      />,
    )
    const status = screen.getByTestId('interactive-agent-status')
    expect(status).toHaveTextContent(/Paused/)
    const btn = screen.getByTestId('interactive-agent-pause')
    expect(btn).toHaveTextContent(/Resume/)
    fireEvent.click(btn)
    await waitFor(() => {
      expect(interactiveMocks.agentResume).toHaveBeenCalledWith('task-1')
    })
    expect(interactiveMocks.agentPause).not.toHaveBeenCalled()
  })

  it('locks the model dropdown when paused', () => {
    render(
      <InteractiveAgentView
        taskId="task-1"
        workingDir="/tmp"
        agentStatus="running"
        agentPausedAt={Date.now()}
      />,
    )
    expect(screen.getByTestId('interactive-agent-model')).toBeDisabled()
  })

  it('model dropdown forwards selection to agentSwitchModel', async () => {
    render(
      <InteractiveAgentView
        taskId="task-1"
        workingDir="/tmp"
        agentStatus="idle"
      />,
    )
    const select = screen.getByTestId('interactive-agent-model')
    fireEvent.change(select, { target: { value: 'sonnet' } })
    await waitFor(() => {
      expect(interactiveMocks.agentSwitchModel).toHaveBeenCalledWith('task-1', 'sonnet')
    })
  })

  it('disables live controls when the agent is stopped', () => {
    render(
      <InteractiveAgentView
        taskId="task-1"
        workingDir="/tmp"
        agentStatus="completed"
      />,
    )

    expect(screen.getByTestId('interactive-agent-model')).toBeDisabled()
    expect(screen.getByTestId('interactive-agent-pause')).toBeDisabled()
    expect(screen.getByTestId('interactive-agent-interrupt')).toBeDisabled()
  })
})
