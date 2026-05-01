import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'

import App from './app'
import { useWorkspaceStore } from '@/stores/workspace-store'
import type { Workspace } from '@/types'

vi.mock('@/hooks/use-agent-streaming-sync', () => ({
  useAgentStreamingSync: vi.fn(),
}))

vi.mock('@/hooks/use-cli-path', () => ({
  useAutoDetectClis: vi.fn(() => ({ isDetecting: false })),
}))

vi.mock('@/hooks/use-pr-status-polling', () => ({
  usePrStatusPolling: vi.fn(),
}))

vi.mock('@/hooks/use-task-sync', () => ({
  useTaskSync: vi.fn(),
}))

vi.mock('@/components/layout/board', () => ({
  Board: () => <input aria-label="board input" />,
}))

vi.mock('@/components/layout/tab-bar', () => ({
  TabBar: () => <div data-testid="tab-bar" />,
}))

vi.mock('@/components/layout/workspace-setup', () => ({
  WorkspaceSetup: () => <div data-testid="workspace-setup" />,
}))

vi.mock('@/components/onboarding/onboarding-wizard', () => ({
  OnboardingWizard: () => <div data-testid="onboarding-wizard" />,
}))

vi.mock('@/components/settings/settings-panel', () => ({
  SettingsPanel: () => <div data-testid="settings-panel" />,
}))

vi.mock('@/components/checklist/checklist-panel', () => ({
  ChecklistPanel: () => <div data-testid="checklist-panel" />,
}))

vi.mock('@/components/about/about-modal', () => ({
  AboutModal: ({ onClose }: { onClose: () => void }) => (
    <button type="button" onClick={onClose}>About</button>
  ),
}))

vi.mock('@/components/command-palette/command-palette', () => ({
  CommandPalette: ({ onClose }: { onClose: () => void }) => (
    <button type="button" onClick={onClose}>Command Palette</button>
  ),
}))

const workspace: Workspace = {
  id: 'ws-1',
  name: 'Workspace',
  repoPath: '/repo',
  tabOrder: 0,
  isActive: true,
  activeTaskCount: 0,
  config: '{}',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
}

describe('App keyboard shortcuts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(invoke).mockResolvedValue([workspace])
    useWorkspaceStore.setState({
      workspaces: [workspace],
      activeWorkspaceId: workspace.id,
      loaded: true,
    })
  })

  it('opens the keyboard shortcuts modal when question mark is pressed', async () => {
    render(<App />)
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('list_workspaces', undefined)
    })

    fireEvent.keyDown(window, { key: '?', shiftKey: true })

    expect(screen.getByRole('dialog', { name: /keyboard shortcuts/i })).toBeInTheDocument()
  })

  it('does not open the keyboard shortcuts modal while typing in an input', async () => {
    render(<App />)
    await waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('list_workspaces', undefined)
    })

    fireEvent.keyDown(screen.getByLabelText('board input'), { key: '?', shiftKey: true })

    expect(screen.queryByRole('dialog', { name: /keyboard shortcuts/i })).not.toBeInTheDocument()
  })
})
