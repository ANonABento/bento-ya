import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { DiffSection } from './diff-section'
import type { ChangeSummary } from '@/hooks/use-git'

const changes: ChangeSummary = {
  totalFiles: 8,
  totalAdditions: 36,
  totalDeletions: 12,
  files: Array.from({ length: 8 }, (_, index) => ({
    path: `src/file-${String(index + 1)}.ts`,
    status: 'modified',
    additions: index + 1,
    deletions: index,
  })),
}

describe('DiffSection', () => {
  it('truncates the affected file list and can show more or less', () => {
    render(
      <DiffSection
        branch="feature"
        changes={changes}
        loading={false}
        diffLoading={false}
        diffError={null}
        diffByFile={{}}
        loadDiff={vi.fn()}
      />,
    )

    expect(screen.getByText('src/file-1.ts')).toBeInTheDocument()
    expect(screen.queryByText('src/file-8.ts')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show 2 more' }))
    expect(screen.getByText('src/file-8.ts')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show less' }))
    expect(screen.queryByText('src/file-8.ts')).not.toBeInTheDocument()
  })

  it('still supports selecting a file and viewing all diffs', () => {
    const loadDiff = vi.fn().mockResolvedValue('')

    render(
      <DiffSection
        branch="feature"
        changes={changes}
        loading={false}
        diffLoading={false}
        diffError={null}
        diffByFile={{
          'src/file-1.ts': 'diff --git a/src/file-1.ts b/src/file-1.ts\n@@ -1 +1 @@\n-old\n+new',
          __all__: 'diff --git a/src/file-1.ts b/src/file-1.ts\n@@ -1 +1 @@\n-old\n+new',
        }}
        loadDiff={loadDiff}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /src\/file-1\.ts/ }))
    expect(loadDiff).not.toHaveBeenCalled()
    expect(screen.getByText(/old/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'View all' }))
    expect(within(screen.getByTestId('changes-panel')).getByText(/new/)).toBeInTheDocument()
  })
})
