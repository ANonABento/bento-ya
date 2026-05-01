import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getCurrentWebviewMock, setZoomMock, invokeMock } = vi.hoisted(() => ({
  getCurrentWebviewMock: vi.fn(),
  setZoomMock: vi.fn(),
  invokeMock: vi.fn(),
}))

vi.mock('@tauri-apps/api/webview', () => ({
  getCurrentWebview: getCurrentWebviewMock,
}))

vi.mock('./ipc/invoke', () => ({
  invoke: invokeMock,
}))

const STORAGE_KEY = 'bento-window-zoom'

async function importWindowZoom() {
  return import('./window-zoom')
}

async function waitForAsyncZoom() {
  for (let i = 0; i < 10; i += 1) {
    await Promise.resolve()
  }
}

describe('window zoom persistence', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    localStorage.clear()
    getCurrentWebviewMock.mockReturnValue({ setZoom: setZoomMock })
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_window_zoom') return Promise.resolve(null)
      if (cmd === 'set_window_zoom') return Promise.resolve(undefined)
      return Promise.reject(new Error(`Unexpected command: ${cmd}`))
    })
  })

  it('applies a legacy local zoom level on initialization', async () => {
    localStorage.setItem(STORAGE_KEY, '1.25')
    const { initializeWindowZoom } = await importWindowZoom()

    initializeWindowZoom()
    await waitForAsyncZoom()

    expect(setZoomMock).toHaveBeenCalledWith(1.25)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1.25')
    expect(invokeMock).toHaveBeenCalledWith('set_window_zoom', { zoom: 1.25 })
  })

  it('prefers the persisted app zoom over legacy localStorage', async () => {
    localStorage.setItem(STORAGE_KEY, '1.25')
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_window_zoom') return Promise.resolve(1.5)
      if (cmd === 'set_window_zoom') return Promise.resolve(undefined)
      return Promise.reject(new Error(`Unexpected command: ${cmd}`))
    })
    const { initializeWindowZoom } = await importWindowZoom()

    initializeWindowZoom()
    await waitForAsyncZoom()

    expect(setZoomMock).toHaveBeenCalledWith(1.5)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1.5')
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

  it('falls back to local zoom when persisted zoom cannot be read', async () => {
    localStorage.setItem(STORAGE_KEY, '1.2')
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_window_zoom') return Promise.reject(new Error('backend unavailable'))
      if (cmd === 'set_window_zoom') return Promise.resolve(undefined)
      return Promise.reject(new Error(`Unexpected command: ${cmd}`))
    })
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { initializeWindowZoom } = await importWindowZoom()

    initializeWindowZoom()
    await waitForAsyncZoom()

    expect(setZoomMock).toHaveBeenCalledWith(1.2)
    expect(consoleError).toHaveBeenCalledWith(
      '[window-zoom] Failed to read persisted zoom:',
      expect.any(Error),
    )

    consoleError.mockRestore()
  })

  it('ignores a delayed persisted zoom after the user changes zoom', async () => {
    let resolvePersistedZoom: (zoom: number | null) => void = () => {}
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_window_zoom') {
        return new Promise<number | null>((resolve) => {
          resolvePersistedZoom = resolve
        })
      }
      if (cmd === 'set_window_zoom') return Promise.resolve(undefined)
      return Promise.reject(new Error(`Unexpected command: ${cmd}`))
    })
    const { initializeWindowZoom } = await importWindowZoom()

    initializeWindowZoom()
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '=', ctrlKey: true }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: '-', ctrlKey: true }))
    resolvePersistedZoom(1.5)
    await waitForAsyncZoom()

    expect(setZoomMock).not.toHaveBeenCalledWith(1.5)
    expect(setZoomMock).toHaveBeenLastCalledWith(1)
    expect(localStorage.getItem(STORAGE_KEY)).toBe('1')
  })

  it('treats malformed persisted zoom as missing', async () => {
    localStorage.setItem(STORAGE_KEY, '1.2')
    invokeMock.mockImplementation((cmd: string) => {
      if (cmd === 'get_window_zoom') return Promise.resolve(Number.NaN)
      if (cmd === 'set_window_zoom') return Promise.resolve(undefined)
      return Promise.reject(new Error(`Unexpected command: ${cmd}`))
    })
    const { initializeWindowZoom } = await importWindowZoom()

    initializeWindowZoom()
    await waitForAsyncZoom()

    expect(setZoomMock).toHaveBeenCalledWith(1.2)
    expect(invokeMock).toHaveBeenCalledWith('set_window_zoom', { zoom: 1.2 })
  })
})
