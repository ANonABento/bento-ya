import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { SectionSwitcher } from './section-switcher'
import { useUIStore } from '@/stores/ui-store'

describe('SectionSwitcher', () => {
  beforeEach(() => {
    cleanup()
    useUIStore.setState({ activeSection: 'board' })
  })

  it('marks the active section and switches on click', () => {
    render(<SectionSwitcher />)

    expect(screen.getByTestId('section-board')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('section-roster')).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByTestId('section-roster'))

    expect(useUIStore.getState().activeSection).toBe('roster')
    expect(screen.getByTestId('section-roster')).toHaveAttribute('aria-pressed', 'true')
  })

  it('does not disturb viewMode', () => {
    // activeSection is deliberately separate from viewMode, which means "is the
    // chat panel open" and is load-bearing via isChatOpen. Conflating them
    // would close the chat panel every time you switched sections.
    useUIStore.setState({ viewMode: 'chat', activeTaskId: 't1' })
    render(<SectionSwitcher />)

    fireEvent.click(screen.getByTestId('section-roster'))

    expect(useUIStore.getState().viewMode).toBe('chat')
    expect(useUIStore.getState().activeTaskId).toBe('t1')
  })
})
