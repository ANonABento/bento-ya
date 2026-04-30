import { render, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { useKeyboardShortcuts } from './use-keyboard-shortcuts'

function ShortcutHarness({
  onShortcut,
  onEscape,
}: {
  onShortcut: () => void
  onEscape: () => void
}) {
  useKeyboardShortcuts([
    { key: '?', shift: true, handler: onShortcut, ignoreEditable: true },
    { key: 'Escape', handler: onEscape, preventDefault: false },
  ])

  return (
    <div>
      <input aria-label="editable" />
      <button type="button">button</button>
    </div>
  )
}

describe('useKeyboardShortcuts', () => {
  it('runs a shifted shortcut when focus is not in an editable element', () => {
    const onShortcut = vi.fn()
    render(<ShortcutHarness onShortcut={onShortcut} onEscape={vi.fn()} />)

    fireEvent.keyDown(window, { key: '?', shiftKey: true })

    expect(onShortcut).toHaveBeenCalledTimes(1)
  })

  it('ignores editable targets when requested', () => {
    const onShortcut = vi.fn()
    const { getByLabelText } = render(<ShortcutHarness onShortcut={onShortcut} onEscape={vi.fn()} />)

    fireEvent.keyDown(getByLabelText('editable'), { key: '?', shiftKey: true })

    expect(onShortcut).not.toHaveBeenCalled()
  })

  it('can run Escape without preventing the default event', () => {
    const onEscape = vi.fn()
    render(<ShortcutHarness onShortcut={vi.fn()} onEscape={onEscape} />)

    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    window.dispatchEvent(event)

    expect(onEscape).toHaveBeenCalledTimes(1)
    expect(event.defaultPrevented).toBe(false)
  })
})
