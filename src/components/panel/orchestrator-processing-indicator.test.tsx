import { act, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ProcessingIndicator } from './orchestrator-processing-indicator'

describe('ProcessingIndicator', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('increments once per second while active and resets when startTime becomes null', () => {
    const startTime = Date.now()
    const { rerender } = render(<ProcessingIndicator startTime={startTime} />)

    expect(screen.getByText('Thinking...')).toBeInTheDocument()

    act(() => {
      vi.advanceTimersByTime(2000)
    })
    expect(screen.getByText('Thinking... 2s')).toBeInTheDocument()

    rerender(<ProcessingIndicator startTime={null} />)
    expect(screen.getByText('Thinking...')).toBeInTheDocument()
  })
})
