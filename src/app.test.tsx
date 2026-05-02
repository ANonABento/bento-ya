import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './app'
import { isEditableTarget } from '@/lib/keyboard'
import { useWorkspaceStore } from '@/stores/workspace-store'

vi.mock('@/hooks/use-pr-status-polling', () => ({ usePrStatusPolling: vi.fn() }))
vi.mock('@/hooks/use-task-sync', () => ({ useTaskSync: vi.fn() }))
vi.mock('@/hooks/use-agent-streaming-sync', () => ({ useAgentStreamingSync: vi.fn() }))
vi.mock('@/hooks/use-cli-path', () => ({ useAutoDetectClis: vi.fn() }))
vi.mock('@/components/layout/board', () => ({ Board: () => <div>Board</div> }))
vi.mock('@/components/layout/workspace-setup', () => ({ WorkspaceSetup: () => <div>Workspace setup</div> }))
vi.mock('@/components/onboarding/onboarding-wizard', () => ({ OnboardingWizard: () => <div>Onboarding</div> }))
vi.mock('@/components/layout/tab-bar', () => ({ TabBar: () => <div>Tabs</div> }))
vi.mock('@/components/settings/settings-panel', () => ({ SettingsPanel: () => null }))
vi.mock('@/components/checklist/checklist-panel', () => ({ ChecklistPanel: () => null }))
vi.mock('@/components/shared/skeleton-loader', () => ({ SkeletonLoader: () => <div>Loading</div> }))

vi.mock('@/components/command-palette/command-palette', () => ({
  CommandPalette: ({ onClose, onShowShortcuts }: { onClose: () => void; onShowShortcuts: () => void }) => (
    <div role="dialog" aria-label="Command palette">
      <button type="button" onClick={onShowShortcuts}>Show keyboard shortcuts</button>
      <button type="button" onClick={onClose}>Close palette</button>
    </div>
  ),
}))

const workspace = {
  id: 'ws-1',
  name: 'Workspace',
  repoPath: '/tmp/workspace',
  tabOrder: 0,
  isActive: true,
  activeTaskCount: 0,
  config: '{}',
  createdAt: '2024-01-01T00:00:00Z',
  updatedAt: '2024-01-01T00:00:00Z',
}

describe('App keyboard shortcuts overlay', () => {
  beforeEach(() => {
    useWorkspaceStore.setState({
      loaded: true,
      workspaces: [workspace],
      activeWorkspaceId: workspace.id,
      load: vi.fn().mockResolvedValue(undefined),
    })
  })

  afterEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('opens shortcuts with ? when focus is outside an editable field', async () => {
    render(<App />)

    fireEvent.keyDown(window, { key: '?' })

    expect(await screen.findByRole('dialog', { name: 'Keyboard Shortcuts' })).toBeInTheDocument()
  })

  it('does not open shortcuts with ? while typing in an input', () => {
    render(
      <>
        <input aria-label="Task title" />
        <App />
      </>,
    )

    fireEvent.keyDown(screen.getByLabelText('Task title'), { key: '?' })

    expect(screen.queryByRole('dialog', { name: 'Keyboard Shortcuts' })).not.toBeInTheDocument()
  })

  it('does not open global command shortcuts while typing in an input', () => {
    render(
      <>
        <input aria-label="Task title" />
        <App />
      </>,
    )

    fireEvent.keyDown(screen.getByLabelText('Task title'), { key: '/', metaKey: true })

    expect(screen.queryByRole('dialog', { name: 'Keyboard Shortcuts' })).not.toBeInTheDocument()
  })

  it('opens shortcuts from Cmd+/ and closes them with Escape', async () => {
    render(<App />)

    fireEvent.keyDown(window, { key: '/', metaKey: true })

    expect(await screen.findByRole('dialog', { name: 'Keyboard Shortcuts' })).toBeInTheDocument()

    fireEvent.keyDown(window, { key: 'Escape' })

    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Keyboard Shortcuts' })).not.toBeInTheDocument()
    })
  })

  it('treats form fields and contenteditable nodes as editable targets', () => {
    const input = document.createElement('input')
    const textarea = document.createElement('textarea')
    const select = document.createElement('select')
    const contentEditable = document.createElement('div')
    contentEditable.setAttribute('contenteditable', 'true')

    expect(isEditableTarget(input)).toBe(true)
    expect(isEditableTarget(textarea)).toBe(true)
    expect(isEditableTarget(select)).toBe(true)
    expect(isEditableTarget(contentEditable)).toBe(true)
    expect(isEditableTarget(document.createElement('button'))).toBe(false)
    expect(isEditableTarget(null)).toBe(false)
  })
})
