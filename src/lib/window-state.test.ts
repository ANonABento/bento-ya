import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { initializeWindowZoomState } from './window-state'

const setZoom = vi.hoisted(() => vi.fn(() => Promise.resolve()))

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: () => ({
    setZoom,
  }),
}))

type TauriWindow = Window & { __TAURI_INTERNALS__?: unknown }

describe('window zoom state', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setZoom.mockClear()
    Object.defineProperty(window, '__TAURI_INTERNALS__', {
      configurable: true,
      value: {},
    })
  })

  afterEach(() => {
    window.dispatchEvent(new Event('pagehide'))
    Reflect.deleteProperty(window as TauriWindow, '__TAURI_INTERNALS__')
  })

  it('restores persisted zoom on startup', async () => {
    window.localStorage.setItem('bento-window-zoom', '1.25')

    await initializeWindowZoomState()

    expect(setZoom).toHaveBeenCalledWith(1.25)
  })

  it('persists app zoom keyboard shortcuts', async () => {
    await initializeWindowZoomState()

    const event = new KeyboardEvent('keydown', {
      key: '=',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    })

    window.dispatchEvent(event)

    await vi.waitFor(() => {
      expect(setZoom).toHaveBeenCalledWith(1.1)
    })
    expect(event.defaultPrevented).toBe(true)
    expect(window.localStorage.getItem('bento-window-zoom')).toBe('1.1')
  })

  it('resets app zoom with the standard shortcut', async () => {
    window.localStorage.setItem('bento-window-zoom', '1.4')
    await initializeWindowZoomState()

    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: '0',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )

    await vi.waitFor(() => {
      expect(setZoom).toHaveBeenLastCalledWith(1)
    })
    expect(window.localStorage.getItem('bento-window-zoom')).toBe('1')
  })
})
