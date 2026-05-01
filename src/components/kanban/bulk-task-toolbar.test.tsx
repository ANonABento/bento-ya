import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BulkTaskToolbar } from './bulk-task-toolbar'
import { mockKanbanColumn } from '@/test/mocks/tauri'

function renderToolbar(currentColumnIds: Set<string>) {
  render(
    <BulkTaskToolbar
      selectedCount={2}
      columns={[
        mockKanbanColumn({ id: 'todo', name: 'Todo', position: 0 }),
        mockKanbanColumn({ id: 'doing', name: 'Doing', position: 1 }),
        mockKanbanColumn({ id: 'done', name: 'Done', position: 2 }),
      ]}
      currentColumnIds={currentColumnIds}
      archiveColumnId={null}
      onMoveToColumn={vi.fn()}
      onArchive={vi.fn()}
      onDelete={vi.fn()}
      onClear={vi.fn()}
    />,
  )
}

describe('BulkTaskToolbar', () => {
  it('hides the only current column for single-column selections', () => {
    renderToolbar(new Set(['todo']))

    expect(screen.queryByRole('option', { name: 'Todo' })).not.toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Doing' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Done' })).toBeInTheDocument()
  })

  it('keeps selected columns available for mixed-column selections', () => {
    renderToolbar(new Set(['todo', 'doing']))

    expect(screen.getByRole('option', { name: 'Todo' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Doing' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Done' })).toBeInTheDocument()
  })
})
