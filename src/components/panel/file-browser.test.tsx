import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import type { DirEntry } from '@/lib/ipc'

const listWorkspaceDir = vi.hoisted(() => vi.fn())
vi.mock('@/lib/ipc', () => ({ listWorkspaceDir }))

import { FileBrowser } from './file-browser'

describe('FileBrowser', () => {
  it('lists the root, lazily expands a directory, and selects a file', async () => {
    const root: DirEntry[] = [
      { path: 'src', name: 'src', isDir: true },
      { path: 'README.md', name: 'README.md', isDir: false },
    ]
    const srcChildren: DirEntry[] = [{ path: 'src/main.rs', name: 'main.rs', isDir: false }]
    listWorkspaceDir.mockImplementation((_ws: string, rel?: string) =>
      Promise.resolve(rel === 'src' ? srcChildren : root),
    )

    const onSelectFile = vi.fn()
    render(<FileBrowser workspaceId="ws-1" selectedPath={null} onSelectFile={onSelectFile} />)

    // Root loads lazily.
    await screen.findByText('src')
    expect(screen.getByText('README.md')).toBeInTheDocument()

    // Expanding a directory fetches and shows its children.
    fireEvent.click(screen.getByText('src'))
    await screen.findByText('main.rs')
    expect(listWorkspaceDir).toHaveBeenCalledWith('ws-1', 'src')

    // Selecting a file bubbles up the relative path + name.
    fireEvent.click(screen.getByText('main.rs'))
    expect(onSelectFile).toHaveBeenCalledWith({ path: 'src/main.rs', name: 'main.rs' })
  })
})
