import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { useResolvedRuntimeMode } from './use-resolved-runtime-mode'

const ipcMocks = vi.hoisted(() => ({
  resolveRuntimeMode: vi.fn(),
  listen: vi.fn(),
}))

vi.mock('@/lib/ipc/agent-interactive', () => ({
  resolveRuntimeMode: ipcMocks.resolveRuntimeMode,
}))

vi.mock('@/lib/ipc', () => ({
  listen: ipcMocks.listen,
}))

describe('useResolvedRuntimeMode', () => {
  beforeEach(() => {
    ipcMocks.resolveRuntimeMode.mockReset()
    ipcMocks.listen.mockReset()
    ipcMocks.listen.mockResolvedValue(() => {})
  })

  it('resolves to headless·bubbles default when invoke succeeds', async () => {
    ipcMocks.resolveRuntimeMode.mockResolvedValue({
      mode: 'headless',
      render: 'bubbles',
      source: 'default',
      interactiveDevFlagRequired: false,
    })

    const { result } = renderHook(() => useResolvedRuntimeMode('task-1'))

    await waitFor(() => { expect(result.current.isLoading).toBe(false) })
    expect(result.current.mode).toBe('headless')
    expect(result.current.render).toBe('bubbles')
    expect(result.current.source).toBe('default')
    expect(result.current.error).toBeNull()
  })

  it('surfaces interactive mode + dev flag requirement', async () => {
    ipcMocks.resolveRuntimeMode.mockResolvedValue({
      mode: 'interactive',
      render: null,
      source: 'trigger',
      interactiveDevFlagRequired: true,
    })

    const { result } = renderHook(() => useResolvedRuntimeMode('task-1'))

    await waitFor(() => { expect(result.current.isLoading).toBe(false) })
    expect(result.current.mode).toBe('interactive')
    expect(result.current.render).toBeNull()
    expect(result.current.interactiveDevFlagRequired).toBe(true)
  })

  it('falls back to headless when invoke errors', async () => {
    ipcMocks.resolveRuntimeMode.mockRejectedValue(new Error('backend offline'))

    const { result } = renderHook(() => useResolvedRuntimeMode('task-1'))

    await waitFor(() => { expect(result.current.isLoading).toBe(false) })
    expect(result.current.mode).toBe('headless')
    expect(result.current.error).toBe('backend offline')
  })

  it('returns the default when taskId is null without calling backend', () => {
    const { result } = renderHook(() => useResolvedRuntimeMode(null))

    // Synchronous fallback path — no invoke, no listener.
    expect(result.current.isLoading).toBe(false)
    expect(result.current.mode).toBe('headless')
    expect(ipcMocks.resolveRuntimeMode).not.toHaveBeenCalled()
    expect(ipcMocks.listen).not.toHaveBeenCalled()
  })
})
