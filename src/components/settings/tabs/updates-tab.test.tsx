import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UpdatesTab } from './updates-tab'
import { checkForUpdate, getUpdateStatus } from '@/lib/ipc/updater'

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: vi.fn(() => Promise.resolve('0.1.0')),
}))

vi.mock('@/lib/ipc/updater', () => ({
  getUpdateStatus: vi.fn(),
  checkForUpdate: vi.fn(),
  installUpdate: vi.fn(),
}))

const mockGetUpdateStatus = vi.mocked(getUpdateStatus)
const mockCheckForUpdate = vi.mocked(checkForUpdate)

describe('UpdatesTab', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('shows an explicit disabled state when updater artifacts are not configured', async () => {
    mockGetUpdateStatus.mockResolvedValue({
      configured: false,
      reason: 'Application updates are disabled for this build because updater artifacts were not generated.',
      endpointCount: 1,
      artifactsEnabled: false,
    })

    render(<UpdatesTab />)

    expect(await screen.findByText(/updater artifacts were not generated/i)).toBeInTheDocument()
    const checkButton = screen.getByRole('button', { name: 'Check for Updates' })
    expect(checkButton).toBeDisabled()

    fireEvent.click(checkButton)
    expect(mockCheckForUpdate).not.toHaveBeenCalled()
  })

  it('checks for updates when the build is configured', async () => {
    mockGetUpdateStatus.mockResolvedValue({
      configured: true,
      reason: null,
      endpointCount: 1,
      artifactsEnabled: true,
    })
    mockCheckForUpdate.mockResolvedValue(null)

    render(<UpdatesTab />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Check for Updates' })).toBeEnabled()
    })

    fireEvent.click(screen.getByRole('button', { name: 'Check for Updates' }))

    expect(mockCheckForUpdate).toHaveBeenCalledTimes(1)
    expect(await screen.findByText(/latest version/i)).toBeInTheDocument()
  })
})
