import { beforeEach, describe, expect, it, vi } from 'vitest'
import { act, render, screen, waitFor } from '@testing-library/react'
import { TerminalView } from './terminal-view'
import { resizePty, ensurePtySession } from '@/lib/ipc/terminal'
import { listen } from '@/lib/ipc'
import { useSettingsStore } from '@/stores/settings-store'
import { DEFAULT_SETTINGS } from '@/types/settings'

const xtermMock = vi.hoisted(() => {
  type Listener = (data: string) => void
  const instances: MockTerminal[] = []
  const fitCalls: Array<{ cols: number; rows: number }> = []

  class MockTerminal {
    static instances = instances
    static fitCalls = fitCalls

    options: Record<string, unknown>
    cols = 0
    rows = 0
    unicode = { activeVersion: '' }
    buffer = { active: { viewportY: 0, baseY: 0 } }
    dataListeners: Listener[] = []
    binaryListeners: Listener[] = []
    writes: Array<string | Uint8Array> = []
    open = vi.fn()
    dispose = vi.fn()
    scrollToBottom = vi.fn()
    attachCustomKeyEventHandler = vi.fn()
    getSelection = vi.fn(() => '')
    clearSelection = vi.fn()
    clear = vi.fn()
    focus = vi.fn()

    constructor(options: Record<string, unknown>) {
      this.options = options
      instances.push(this)
    }

    loadAddon(addon: { activate?: (term: MockTerminal) => void }) {
      addon.activate?.(this)
    }

    onData(listener: Listener) {
      this.dataListeners.push(listener)
      return { dispose: vi.fn() }
    }

    onBinary(listener: Listener) {
      this.binaryListeners.push(listener)
      return { dispose: vi.fn() }
    }

    write(data: string | Uint8Array, callback?: () => void) {
      this.writes.push(data)
      callback?.()
    }
  }

  class MockFitAddon {
    term: MockTerminal | null = null

    activate(term: MockTerminal) {
      this.term = term
    }

    fit() {
      if (!this.term) return
      this.term.cols = 100
      this.term.rows = 30
      fitCalls.push({ cols: this.term.cols, rows: this.term.rows })
    }
  }

  return { MockTerminal, MockFitAddon, instances, fitCalls }
})

const listenerCallbacks = vi.hoisted(() => new Map<string, (payload: unknown) => void>())

vi.mock('@xterm/xterm', () => ({
  Terminal: xtermMock.MockTerminal,
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: xtermMock.MockFitAddon,
}))

vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    onContextLoss() {}
    dispose() {}
  },
}))

vi.mock('@xterm/addon-unicode11', () => ({
  Unicode11Addon: class {
    readonly name = 'unicode11'
  },
}))

vi.mock('@xterm/addon-search', () => ({
  SearchAddon: class {
    readonly name = 'search'
  },
}))

vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

vi.mock('@/lib/ipc/terminal', () => ({
  writeToPty: vi.fn().mockResolvedValue(undefined),
  resizePty: vi.fn().mockResolvedValue(undefined),
  ensurePtySession: vi.fn().mockResolvedValue({ taskId: 'task-1', pid: 123, status: 'running' }),
}))

vi.mock('@/lib/ipc', () => ({
  listen: vi.fn((channel: string, callback: (payload: unknown) => void) => {
    listenerCallbacks.set(channel, callback)
    return Promise.resolve(() => {})
  }),
}))

describe('TerminalView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    listenerCallbacks.clear()
    xtermMock.instances.length = 0
    xtermMock.fitCalls.length = 0
    useSettingsStore.setState({
      global: {
        ...DEFAULT_SETTINGS,
        terminal: {
          ...DEFAULT_SETTINGS.terminal,
          fontSize: 14,
          lineHeight: 18,
          scrollbackLines: 12000,
        },
      },
      workspaceOverrides: {},
    })

    vi.stubGlobal('ResizeObserver', class {
      observe = vi.fn()
      disconnect = vi.fn()
    })
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      callback(0)
      return 1
    })
  })

  it('fits to the panel and starts the PTY with fitted dimensions', async () => {
    render(<TerminalView taskId="task-1" workingDir="/tmp/worktree" />)

    await waitFor(() => {
      expect(ensurePtySession).toHaveBeenCalledWith('task-1', '/tmp/worktree', 100, 30, true)
    })
    expect(resizePty).toHaveBeenCalledWith('task-1', 100, 30)
    expect(xtermMock.instances[0]?.options).toMatchObject({
      fontSize: 14,
      lineHeight: 18 / 14,
      scrollback: 12000,
    })
  })

  it('caps legacy terminal line-height settings to avoid oversized gaps', async () => {
    useSettingsStore.setState({
      global: {
        ...DEFAULT_SETTINGS,
        terminal: {
          ...DEFAULT_SETTINGS.terminal,
          fontSize: 12,
          lineHeight: 20,
        },
      },
      workspaceOverrides: {},
    })

    render(<TerminalView taskId="task-1" workingDir="/tmp/worktree" />)

    await waitFor(() => {
      expect(ensurePtySession).toHaveBeenCalled()
    })
    expect(xtermMock.instances[0]?.options).toMatchObject({
      fontSize: 12,
      lineHeight: 16 / 12,
    })
  })

  it('writes PTY output without forcing scroll when the user is scrolled up', async () => {
    render(<TerminalView taskId="task-1" workingDir="/tmp/worktree" />)
    await waitFor(() => {
      expect(listen).toHaveBeenCalled()
    })

    const term = xtermMock.instances[0]
    const output = listenerCallbacks.get('pty:task-1:output')
    if (!term || !output) {
      throw new Error('expected terminal instance and output listener')
    }

    term.buffer.active.viewportY = 0
    term.buffer.active.baseY = 10
    act(() => {
      output(btoa('first'))
    })
    expect(term.scrollToBottom).not.toHaveBeenCalled()

    term.buffer.active.viewportY = 10
    term.buffer.active.baseY = 10
    act(() => {
      output(btoa('second'))
    })
    expect(term.scrollToBottom).toHaveBeenCalledTimes(1)
  })

  it('shows an attach-only empty state instead of spawning for missing sessions', async () => {
    vi.mocked(ensurePtySession).mockResolvedValueOnce({
      taskId: 'task-1',
      pid: null,
      status: 'Missing',
    })

    render(<TerminalView taskId="task-1" workingDir="/tmp/worktree" allowSpawn={false} />)

    await waitFor(() => {
      expect(ensurePtySession).toHaveBeenCalledWith('task-1', '/tmp/worktree', 100, 30, false)
    })
    expect(await screen.findByText('No live terminal session')).toBeInTheDocument()
    expect(screen.queryByText('Spawning terminal')).not.toBeInTheDocument()
    expect(xtermMock.instances[0]?.writes).toEqual([])
  })

  // jsdom's userAgent isn't a Mac, so the handler uses the Ctrl+Shift bindings.
  function keyHandler() {
    const term = xtermMock.instances[0]
    if (!term) throw new Error('expected terminal instance')
    const handler = term.attachCustomKeyEventHandler.mock.calls[0]?.[0] as
      | ((e: Partial<KeyboardEvent>) => boolean)
      | undefined
    if (!handler) throw new Error('expected a custom key handler')
    return { term, handler }
  }

  it('opens the search box on Ctrl+Shift+F', async () => {
    render(<TerminalView taskId="task-1" workingDir="/tmp/worktree" />)
    await waitFor(() => { expect(ensurePtySession).toHaveBeenCalled() })

    expect(screen.queryByTestId('agent-terminal-search')).not.toBeInTheDocument()
    const { handler } = keyHandler()
    let result: boolean | undefined
    act(() => {
      result = handler({ type: 'keydown', ctrlKey: true, shiftKey: true, key: 'f' })
    })
    // Returning false stops xterm forwarding the key to the PTY.
    expect(result).toBe(false)
    expect(screen.getByTestId('agent-terminal-search')).toBeInTheDocument()
  })

  it('copies the selection on Ctrl+Shift+C and leaves SIGINT alone with no selection', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })

    render(<TerminalView taskId="task-1" workingDir="/tmp/worktree" />)
    await waitFor(() => { expect(ensurePtySession).toHaveBeenCalled() })
    const { term, handler } = keyHandler()

    // With a selection → copy + consume the key.
    term.getSelection.mockReturnValue('selected text')
    expect(handler({ type: 'keydown', ctrlKey: true, shiftKey: true, key: 'c' })).toBe(false)
    expect(writeText).toHaveBeenCalledWith('selected text')

    // With no selection → pass through (so a bare Ctrl+C SIGINT is unaffected).
    term.getSelection.mockReturnValue('')
    expect(handler({ type: 'keydown', ctrlKey: true, shiftKey: true, key: 'c' })).toBe(true)
  })
})
