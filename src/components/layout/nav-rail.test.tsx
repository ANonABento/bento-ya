import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { NavRail } from './nav-rail'
import { useUIStore } from '@/stores/ui-store'

describe('NavRail', () => {
  beforeEach(() => {
    cleanup()
    useUIStore.setState({ activeSection: 'board' })
  })

  it('marks the active section and switches on click', () => {
    render(<NavRail />)

    const board = screen.getByTestId('nav-rail-board')
    const roster = screen.getByTestId('nav-rail-roster')
    expect(board).toHaveAttribute('aria-current', 'page')
    expect(roster).not.toHaveAttribute('aria-current')

    fireEvent.click(roster)

    expect(useUIStore.getState().activeSection).toBe('roster')
    expect(screen.getByTestId('nav-rail-roster')).toHaveAttribute('aria-current', 'page')
  })

  it('does not disturb viewMode', () => {
    // activeSection is deliberately separate from viewMode, which means "is the
    // chat panel open" and is load-bearing via isChatOpen. Conflating them
    // would close the chat panel every time you switched sections.
    useUIStore.setState({ viewMode: 'chat', activeTaskId: 't1' })
    render(<NavRail />)

    fireEvent.click(screen.getByTestId('nav-rail-roster'))

    expect(useUIStore.getState().viewMode).toBe('chat')
    expect(useUIStore.getState().activeTaskId).toBe('t1')
  })
})
