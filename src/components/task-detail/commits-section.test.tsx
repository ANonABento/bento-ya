import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { CommitsSection } from './commits-section'
import type { CommitInfo } from '@/hooks/use-git'

const commits: CommitInfo[] = Array.from({ length: 5 }, (_, index) => ({
  hash: `hash-${String(index + 1)}`,
  shortHash: `h${String(index + 1)}`,
  message: `Commit message ${String(index + 1)}`,
  author: 'Dev',
  timestamp: index,
}))

describe('CommitsSection', () => {
  it('renders a compact truncated list with show more and show less', () => {
    render(<CommitsSection commits={commits} />)

    expect(screen.getByText('5 commits')).toBeInTheDocument()
    expect(screen.getByText('Commit message 1')).toBeInTheDocument()
    expect(screen.queryByText('Commit message 5')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show 2 more' }))
    expect(screen.getByText('Commit message 5')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show less' }))
    expect(screen.queryByText('Commit message 5')).not.toBeInTheDocument()
  })
})
