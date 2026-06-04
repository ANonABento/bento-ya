import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { CliHealthBanner } from './cli-health-banner'
import type { CliHealthReport } from '@/lib/ipc/cli'

vi.mock('@/lib/ipc', () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
}))

// Keep the real `isCliHealthConcerning` logic; only stub the IPC probe.
const mocks = vi.hoisted(() => ({ checkCliHealth: vi.fn() }))
vi.mock('@/lib/ipc/cli', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ipc/cli')>()
  return { ...actual, checkCliHealth: mocks.checkCliHealth }
})

const driftReport: CliHealthReport = {
  id: 'claude',
  name: 'Claude Code',
  available: true,
  path: '/usr/bin/claude',
  version: '2.0.0',
  minVersion: null,
  versionOk: true,
  missingFlags: ['--append-system-prompt'],
  status: 'drift',
}
const okReport: CliHealthReport = {
  ...driftReport,
  id: 'codex',
  name: 'Codex CLI',
  missingFlags: [],
  status: 'ok',
}

describe('CliHealthBanner', () => {
  beforeEach(() => { mocks.checkCliHealth.mockReset() })

  it('warns about a drifted CLI and hides on dismiss', async () => {
    mocks.checkCliHealth.mockResolvedValue([driftReport, okReport])
    render(<CliHealthBanner />)

    await screen.findByText(/compatibility warning/i)
    expect(screen.getByText(/--append-system-prompt/)).toBeInTheDocument()

    fireEvent.click(screen.getByLabelText('Dismiss'))
    await waitFor(() => {
      expect(screen.queryByText(/compatibility warning/i)).not.toBeInTheDocument()
    })
  })

  it('renders nothing when every CLI is healthy', async () => {
    mocks.checkCliHealth.mockResolvedValue([okReport])
    render(<CliHealthBanner />)
    await waitFor(() => { expect(mocks.checkCliHealth).toHaveBeenCalled() })
    expect(screen.queryByText(/compatibility warning/i)).not.toBeInTheDocument()
  })

  it('ignores a missing (uninstalled) CLI', async () => {
    mocks.checkCliHealth.mockResolvedValue([
      { ...okReport, available: false, status: 'missing', path: null, version: null },
    ])
    render(<CliHealthBanner />)
    await waitFor(() => { expect(mocks.checkCliHealth).toHaveBeenCalled() })
    expect(screen.queryByText(/compatibility warning/i)).not.toBeInTheDocument()
  })
})
