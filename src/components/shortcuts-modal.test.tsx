import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ShortcutsModal } from './shortcuts-modal'

describe('ShortcutsModal', () => {
  it('lists the current task, search, and workspace shortcuts', () => {
    render(<ShortcutsModal onClose={vi.fn()} />)

    expect(screen.getByRole('dialog', { name: /keyboard shortcuts/i })).toBeInTheDocument()
    expect(screen.getByText('Search and command palette')).toBeInTheDocument()
    expect(screen.getByText('Switch workspace')).toBeInTheDocument()
    expect(screen.getByText('Move task to next column')).toBeInTheDocument()
    expect(screen.getByText('Run or stop agent')).toBeInTheDocument()
    expect(screen.getByText('Retry failed pipeline')).toBeInTheDocument()
    expect(screen.getAllByText('Confirm/delete task')).toHaveLength(2)
  })

  it('closes when Escape is pressed', () => {
    const onClose = vi.fn()
    render(<ShortcutsModal onClose={onClose} />)

    fireEvent.keyDown(window, { key: 'Escape' })

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
