import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { DiffViewer } from './diff-viewer'

const DIFF = [
  'diff --git a/src/app.ts b/src/app.ts',
  '@@ -1,2 +1,2 @@',
  ' const keep = true',
  '-const value = "old"',
  '+const value = "new"',
].join('\n')

const MULTI_FILE_DIFF = [
  'diff --git a/src/app.ts b/src/app.ts',
  '@@ -1,2 +1,2 @@',
  ' const keep = true',
  '-const value = "old"',
  '+const value = "new"',
  'diff --git a/src/other.ts b/src/other.ts',
  '@@ -10,2 +10,2 @@',
  ' const other = true',
  '-const name = "old"',
  '+const name = "new"',
].join('\n')

let writeTextMock: ReturnType<typeof vi.fn>

describe('DiffViewer actions', () => {
  beforeEach(() => {
    writeTextMock = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: writeTextMock },
    })
  })

  it('selects diff lines and copies the selected snippet', async () => {
    render(<DiffViewer diff={DIFF} selectable />)

    const rows = screen.getAllByTestId('diff-line-row')
    fireEvent.pointerDown(rows[2] as HTMLElement, { button: 0, pointerId: 1 })
    fireEvent.click(screen.getByRole('button', { name: 'Copy selected' }))

    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith(expect.stringContaining('+const value = "new"'))
      expect(writeTextMock).toHaveBeenCalledWith(expect.stringContaining('@@ -1,2 +1,2 @@'))
    })
  })

  it('toggles clicked rows off and clears selection from outside the code area', () => {
    render(<DiffViewer diff={DIFF} selectable />)

    const rows = screen.getAllByTestId('diff-line-row')
    fireEvent.pointerDown(rows[2] as HTMLElement, { button: 0, pointerId: 1 })
    expect(screen.getByText('1 line selected')).toBeInTheDocument()

    fireEvent.pointerDown(rows[2] as HTMLElement, { button: 0, pointerId: 2 })
    expect(screen.getByText('Select diff lines to copy or send context')).toBeInTheDocument()

    fireEvent.pointerDown(rows[2] as HTMLElement, { button: 0, pointerId: 3 })
    fireEvent.pointerDown(screen.getByText('src/app.ts'), { button: 0, pointerId: 4 })
    expect(screen.getByText('Select diff lines to copy or send context')).toBeInTheDocument()
  })

  it('supports shift-click and drag range selection', () => {
    render(<DiffViewer diff={DIFF} selectable />)

    const rows = screen.getAllByTestId('diff-line-row')
    fireEvent.pointerDown(rows[0] as HTMLElement, { button: 0, pointerId: 1 })
    fireEvent.pointerUp(rows[0] as HTMLElement, { pointerId: 1 })
    fireEvent.pointerDown(rows[2] as HTMLElement, { button: 0, pointerId: 2, shiftKey: true })

    expect(screen.getByText('3 lines selected')).toBeInTheDocument()

    fireEvent.pointerDown(rows[0] as HTMLElement, { button: 0, pointerId: 3 })
    fireEvent.pointerEnter(rows[1] as HTMLElement)
    fireEvent.pointerUp(rows[1] as HTMLElement, { pointerId: 3 })

    expect(screen.getByText('2 lines selected')).toBeInTheDocument()
  })

  it('replaces a multi-line selection when clicking one selected line', () => {
    render(<DiffViewer diff={DIFF} selectable />)

    const rows = screen.getAllByTestId('diff-line-row')
    fireEvent.pointerDown(rows[0] as HTMLElement, { button: 0, pointerId: 1 })
    fireEvent.pointerUp(rows[0] as HTMLElement, { pointerId: 1 })
    fireEvent.pointerDown(rows[2] as HTMLElement, { button: 0, pointerId: 2, shiftKey: true })

    expect(screen.getByText('3 lines selected')).toBeInTheDocument()

    fireEvent.pointerDown(rows[1] as HTMLElement, { button: 0, pointerId: 3 })

    expect(screen.getByText('1 line selected')).toBeInTheDocument()
    expect(rows[0]).toHaveAttribute('aria-pressed', 'false')
    expect(rows[1]).toHaveAttribute('aria-pressed', 'true')
    expect(rows[2]).toHaveAttribute('aria-pressed', 'false')
  })

  it('treats shift-click without an anchor as a plain click', () => {
    render(<DiffViewer diff={DIFF} selectable />)

    const rows = screen.getAllByTestId('diff-line-row')
    fireEvent.pointerDown(rows[0] as HTMLElement, { button: 0, pointerId: 1 })
    expect(screen.getByText('1 line selected')).toBeInTheDocument()

    fireEvent.pointerDown(screen.getByText('src/app.ts'), { button: 0, pointerId: 2 })
    expect(screen.getByText('Select diff lines to copy or send context')).toBeInTheDocument()

    fireEvent.pointerDown(rows[2] as HTMLElement, { button: 0, pointerId: 3, shiftKey: true })

    expect(screen.getByText('1 line selected')).toBeInTheDocument()
    expect(rows[2]).toHaveAttribute('aria-pressed', 'true')
  })

  it('clears selection when clicking file header chrome', () => {
    render(<DiffViewer diff={DIFF} selectable />)

    const rows = screen.getAllByTestId('diff-line-row')
    fireEvent.pointerDown(rows[2] as HTMLElement, { button: 0, pointerId: 1 })
    expect(screen.getByText('1 line selected')).toBeInTheDocument()

    fireEvent.pointerDown(screen.getByRole('button', { name: /src\/app\.ts/ }), {
      button: 0,
      pointerId: 2,
    })

    expect(screen.getByText('Select diff lines to copy or send context')).toBeInTheDocument()
  })

  it('clears all selections when clicking file header chrome in a multi-file diff', () => {
    render(<DiffViewer diff={MULTI_FILE_DIFF} selectable />)

    const rows = screen.getAllByTestId('diff-line-row')
    fireEvent.pointerDown(rows[2] as HTMLElement, { button: 0, pointerId: 1 })
    fireEvent.pointerUp(rows[2] as HTMLElement, { pointerId: 1 })
    fireEvent.pointerDown(rows[5] as HTMLElement, { button: 0, pointerId: 2, shiftKey: true })
    expect(screen.getByText('4 lines selected')).toBeInTheDocument()

    fireEvent.pointerDown(screen.getByRole('button', { name: /src\/app\.ts/ }), {
      button: 0,
      pointerId: 3,
    })

    expect(screen.getByText('Select diff lines to copy or send context')).toBeInTheDocument()
    expect(rows[2]).toHaveAttribute('aria-pressed', 'false')
    expect(rows[5]).toHaveAttribute('aria-pressed', 'false')
  })

  it('copies file paths and hunks, and sends hunks to the agent callback', async () => {
    const onSendToAgent = vi.fn()
    render(<DiffViewer diff={DIFF} selectable onSendToAgent={onSendToAgent} />)

    const rows = screen.getAllByTestId('diff-line-row')
    fireEvent.pointerDown(rows[0] as HTMLElement, { button: 0, pointerId: 1 })
    expect(screen.getByText('1 line selected')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Copy path' }))
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith('src/app.ts')
    })

    const copyHunkButton = screen.getByRole('button', { name: 'Copy hunk' })
    fireEvent.pointerDown(copyHunkButton, { button: 0, pointerId: 2 })
    fireEvent.click(copyHunkButton)
    await waitFor(() => {
      expect(writeTextMock).toHaveBeenCalledWith(expect.stringContaining('-const value = "old"'))
    })
    expect(screen.getByText('1 line selected')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Send' }))
    expect(onSendToAgent).toHaveBeenCalledWith(expect.stringContaining('+const value = "new"'))
  })
})
