import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TerminalView } from './terminal-view'

const {
  listenMock,
  ensurePtySessionMock,
  resizePtyMock,
  writeToPtyMock,
  terminalInstances,
  MockTerminal,
  MockFitAddon,
  MockSearchAddon,
  MockUnicode11Addon,
  MockWebglAddon,
} = vi.hoisted(() => {
  const listenMock = vi.fn()
  const ensurePtySessionMock = vi.fn()
  const resizePtyMock = vi.fn()
  const writeToPtyMock = vi.fn()
  const terminalInstances: Array<{
    options: Record<string, unknown>
    cols: number
    rows: number
    write: ReturnType<typeof vi.fn>
    open: ReturnType<typeof vi.fn>
    loadAddon: ReturnType<typeof vi.fn>
    dispose: ReturnType<typeof vi.fn>
    onData: ReturnType<typeof vi.fn>
    onBinary: ReturnType<typeof vi.fn>
    unicode: { activeVersion: string }
  }> = []

  class MockTerminal {
    options: Record<string, unknown>
    cols = 80
    rows = 24
    write = vi.fn()
    open = vi.fn()
    loadAddon = vi.fn()
    dispose = vi.fn()
    onData = vi.fn(() => ({ dispose: vi.fn() }))
    onBinary = vi.fn(() => ({ dispose: vi.fn() }))
    unicode = { activeVersion: '' }

    constructor(options: Record<string, unknown>) {
      this.options = options
      terminalInstances.push(this)
    }
  }

  class MockFitAddon {
    fit = vi.fn()
  }

  class MockSearchAddon {
    addonName = 'search'
  }

  class MockUnicode11Addon {
    addonName = 'unicode11'
  }

  class MockWebglAddon {
    onContextLoss = vi.fn()
    dispose = vi.fn()
  }

  return {
    listenMock,
    ensurePtySessionMock,
    resizePtyMock,
    writeToPtyMock,
    terminalInstances,
    MockTerminal,
    MockFitAddon,
    MockSearchAddon,
    MockUnicode11Addon,
    MockWebglAddon,
  }
})

vi.mock('@xterm/xterm', () => ({
  Terminal: MockTerminal,
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: MockFitAddon,
}))

vi.mock('@xterm/addon-search', () => ({
  SearchAddon: MockSearchAddon,
}))

vi.mock('@xterm/addon-unicode11', () => ({
  Unicode11Addon: MockUnicode11Addon,
}))

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: MockWebglAddon,
}))

vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

vi.mock('@/lib/ipc/invoke', () => ({
  listen: listenMock,
}))

vi.mock('@/lib/ipc/terminal', () => ({
  ensurePtySession: ensurePtySessionMock,
  resizePty: resizePtyMock,
  writeToPty: writeToPtyMock,
}))

vi.mock('@/stores/theme-store', () => ({
  useThemeStore: (selector: (state: { resolved: 'dark' | 'light' }) => unknown) =>
    selector({ resolved: 'dark' }),
}))

vi.mock('./agent-output', () => ({
  AgentOutput: ({ rawOutput }: { rawOutput: string }) => (
    <div data-testid="agent-output">{rawOutput}</div>
  ),
}))

describe('TerminalView', () => {
  beforeEach(() => {
    terminalInstances.length = 0
    listenMock.mockReset()
    ensurePtySessionMock.mockReset()
    resizePtyMock.mockReset()
    writeToPtyMock.mockReset()
    ensurePtySessionMock.mockResolvedValue({
      taskId: 'task-1',
      pid: 123,
      status: 'running',
    })

    globalThis.ResizeObserver = class {
      observe = vi.fn()
      disconnect = vi.fn()
    } as unknown as typeof ResizeObserver
  })

  it('waits for PTY listeners before ensuring the session', async () => {
    const listenerResolvers: Array<(value: () => void) => void> = []
    listenMock.mockImplementation(
      () =>
        new Promise<() => void>((resolve) => {
          listenerResolvers.push(resolve)
        }),
    )

    render(<TerminalView taskId="task-1" workingDir="/tmp/worktree" />)

    expect(ensurePtySessionMock).not.toHaveBeenCalled()

    listenerResolvers.forEach((resolve) => {
      resolve(() => {})
    })

    await waitFor(() => {
      expect(ensurePtySessionMock).toHaveBeenCalledWith('task-1', '/tmp/worktree', 80, 24)
    })
  })

  it('does not recreate the xterm instance when raw output streams in', async () => {
    const handlers = new Map<
      string,
      (payload: { task_id: string; data?: string; exit_code?: number | null }) => void
    >()

    listenMock.mockImplementation(
      (
        event: string,
        handler: (payload: { task_id: string; data?: string; exit_code?: number | null }) => void,
      ) => {
        handlers.set(event, handler)
        return Promise.resolve(() => {})
      },
    )

    render(<TerminalView taskId="task-1" workingDir="/tmp/worktree" />)

    fireEvent.click(screen.getByRole('button', { name: 'Raw' }))

    await waitFor(() => {
      expect(terminalInstances).toHaveLength(1)
    })

    act(() => {
      handlers.get('pty:task-1:output')?.({
        task_id: 'task-1',
        data: btoa('hello world'),
      })
    })

    await waitFor(() => {
      expect(terminalInstances[0]?.write).toHaveBeenCalled()
    })

    expect(terminalInstances).toHaveLength(1)
    expect(ensurePtySessionMock).toHaveBeenCalledTimes(1)
  })
})
