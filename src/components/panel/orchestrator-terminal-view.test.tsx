import { render, waitFor } from '@testing-library/react'
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

describe('OrchestratorTerminalView', () => {
  it('points TerminalView at the chef session key and routes ensure to the chef command', async () => {
    render(<OrchestratorTerminalView workspaceId="ws-1" />)

    expect(captured.props?.taskId).toBe('chef_ws-1')

    // The ensure strategy ignores the per-task id/cwd and targets the workspace.
    await captured.props?.ensure?.('chef_ws-1', '', 80, 24, true)
    await waitFor(() => {
      expect(ensureChefTerminal).toHaveBeenCalledWith('ws-1', 80, 24, true)
    })
  })
})
