import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getCurrentWebviewMock, setZoomMock } = vi.hoisted(() => ({
  getCurrentWebviewMock: vi.fn(),
  setZoomMock: vi.fn(),
}))

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: getCurrentWebviewMock,
}))

const STORAGE_KEY = 'bento-window-zoom'

async function importWindowZoom() {
  return import('./window-zoom')
}

async function waitForAsyncZoom() {
  await Promise.resolve()
}

describe('window zoom persistence', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    localStorage.clear()
    getCurrentWebviewMock.mockReturnValue({ setZoom: setZoomMock })
  })

  it('applies a stored zoom level on initialization', async () => {
    localStorage.setItem(STORAGE_KEY, '1.25')
    const { initializeWindowZoom } = await importWindowZoom()

    initializeWindowZoom()
    await waitForAsyncZoom()

    expect(setZoomMock).toHaveBeenCalledWith(1.25)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1.25')
  })

  it('updates and persists zoom from keyboard shortcuts', async () => {
    const { initializeWindowZoom } = await importWindowZoom()

    initializeWindowZoom()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '=', ctrlKey: true }))
    await waitForAsyncZoom()

    expect(setZoomMock).toHaveBeenLastCalledWith(1.1)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1.1')
  })

  it('clamps invalid stored and shortcut zoom values to supported bounds', async () => {
    localStorage.setItem(STORAGE_KEY, '4')
    const { initializeWindowZoom } = await importWindowZoom()

    initializeWindowZoom()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '+', metaKey: true }))
    await waitForAsyncZoom()

    expect(setZoomMock).toHaveBeenLastCalledWith(2)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('2')
  })

  it('does not attach duplicate shortcut handlers when initialized twice', async () => {
    const addEventListenerSpy = vi.spyOn(window, 'addEventListener')
    const { initializeWindowZoom } = await importWindowZoom()

    initializeWindowZoom()
    initializeWindowZoom()
    await waitForAsyncZoom()

    const keydownRegistrations = addEventListenerSpy.mock.calls.filter(
      ([eventName]) => eventName === 'keydown',
    )
    expect(keydownRegistrations).toHaveLength(1)

    addEventListenerSpy.mockRestore()
  })

  it('falls back to default zoom when stored data cannot be read', async () => {
    vi.spyOn(localStorage, 'getItem').mockImplementationOnce(() => {
      throw new Error('storage unavailable')
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { initializeWindowZoom } = await importWindowZoom()

    initializeWindowZoom()
    await waitForAsyncZoom()

    expect(setZoomMock).toHaveBeenCalledWith(1)
    expect(consoleError).toHaveBeenCalledWith(
      '[window-zoom] Failed to read stored zoom:',
      expect.any(Error),
    )

    consoleError.mockRestore()
  })
})
