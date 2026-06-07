import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import type { EnsureSessionFn } from '@/lib/ipc/terminal'

type CapturedProps = { taskId: string; workingDir: string; ensure?: EnsureSessionFn }
const captured = vi.hoisted(() => ({ props: undefined as CapturedProps | undefined }))

vi.mock('./terminal-view', () => ({
  TerminalView: (props: CapturedProps) => {
    captured.props = props
    return <div data-testid="terminal-view" />
  },
}))

const ensureChefTerminal = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ taskId: 'chef_ws-1', pid: 1, status: 'Running' }),
)
vi.mock('@/lib/ipc/terminal', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ipc/terminal')>()
  return { ...actual, ensureChefTerminal }
})

import { OrchestratorTerminalView } from './orchestrator-terminal-view'

const noop = () => {}

describe('OrchestratorTerminalView', () => {
  it('points TerminalView at the chef session key and routes ensure to the chef command', async () => {
    render(
      <OrchestratorTerminalView
        workspaceId="ws-1"
        shells={[1]}
        activeShell={1}
        onSelectShell={noop}
        onCloseShell={noop}
      />,
    )

    expect(captured.props?.taskId).toBe('chef_ws-1')
    // Single shell → no tab strip.
    expect(screen.queryByTestId('chef-shell-tabs')).not.toBeInTheDocument()

    await captured.props?.ensure?.('chef_ws-1', '', 80, 24, true)
    await waitFor(() => {
      expect(ensureChefTerminal).toHaveBeenCalledWith('ws-1', 80, 24, true, 1)
    })
  })

  it('shows a shell tab strip with multiple shells and targets the active shell session', () => {
    const onSelectShell = vi.fn()
    const onCloseShell = vi.fn()
    render(
      <OrchestratorTerminalView
        workspaceId="ws-1"
        shells={[1, 2]}
        activeShell={2}
        onSelectShell={onSelectShell}
        onCloseShell={onCloseShell}
      />,
    )

    // Tab strip visible; active shell drives the terminal session key.
    expect(screen.getByTestId('chef-shell-tabs')).toBeInTheDocument()
    expect(captured.props?.taskId).toBe('chef_ws-1_2')

    // Switch to shell 1.
    fireEvent.click(screen.getByTestId('chef-shell-tab-1'))
    expect(onSelectShell).toHaveBeenCalledWith(1)

    // Close shell 2.
    fireEvent.click(screen.getByTestId('chef-shell-close-2'))
    expect(onCloseShell).toHaveBeenCalledWith(2)
  })
})
