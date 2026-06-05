import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { PanelTabs, type PanelTab } from './panel-tabs'

type View = 'a' | 'b'
const TABS: readonly PanelTab<View>[] = [
  { value: 'a', label: 'Alpha', testId: 'tab-a' },
  { value: 'b', label: 'Beta', testId: 'tab-b' },
]

describe('PanelTabs', () => {
  it('marks the active tab via aria-pressed and fires onChange on click', () => {
    const onChange = vi.fn()
    render(<PanelTabs tabs={TABS} value="a" onChange={onChange} aria-label="Views" />)

    expect(screen.getByTestId('tab-a')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('tab-b')).toHaveAttribute('aria-pressed', 'false')

    fireEvent.click(screen.getByRole('button', { name: 'Beta' }))
    expect(onChange).toHaveBeenCalledWith('b')
  })
})
