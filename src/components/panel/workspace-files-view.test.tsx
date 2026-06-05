import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import type { FileEntry } from '@/lib/ipc'

const planFile: FileEntry = { path: 'PLAN.md', name: 'PLAN.md', category: 'notes', modifiedAt: 0 }

const refresh = vi.hoisted(() => vi.fn())
vi.mock('@/hooks/use-workspace-files', () => ({
  useWorkspaceFiles: () => ({
    groupedFiles: { context: [], tickets: [], notes: [planFile] },
    loading: false,
    refresh,
  }),
}))

// Stub the tree to a single selectable button, and the preview to echo the file
// name — the view's own job (master-detail wiring + empty state) is what we test.
vi.mock('./files-tree', () => ({
  FilesTree: ({ onSelectFile }: { onSelectFile: (f: FileEntry) => void }) => (
    <button data-testid="pick-plan" onClick={() => { onSelectFile(planFile) }}>PLAN.md</button>
  ),
}))
vi.mock('./file-preview', () => ({
  FilePreview: ({ file }: { file: FileEntry }) => <div data-testid="file-preview">{file.name}</div>,
}))

import { WorkspaceFilesView } from './workspace-files-view'

describe('WorkspaceFilesView', () => {
  it('shows an empty state until a file is selected, then renders its preview', () => {
    render(<WorkspaceFilesView workspaceId="ws-1" />)

    expect(screen.getByText('No file selected')).toBeInTheDocument()
    expect(screen.queryByTestId('file-preview')).not.toBeInTheDocument()

    fireEvent.click(screen.getByTestId('pick-plan'))

    expect(screen.getByTestId('file-preview')).toHaveTextContent('PLAN.md')
    expect(screen.queryByText('No file selected')).not.toBeInTheDocument()
  })

  it('exposes a refresh control that rescans workspace files', () => {
    render(<WorkspaceFilesView workspaceId="ws-1" />)
    fireEvent.click(screen.getByLabelText('Refresh files'))
    expect(refresh).toHaveBeenCalled()
  })
})
