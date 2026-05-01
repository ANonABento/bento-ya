import { getCurrentWindow } from '@tauri-apps/api/window'
import { getCurrentWebview } from '@tauri-apps/api/webview'

const WINDOW_ZOOM_KEY = 'bento-window-zoom'
const MIN_ZOOM = 0.2
const MAX_ZOOM = 5

const inRange = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    return 1
  }
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value))
}

const hasTauriInternals = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

const readPersistedZoom = (): number | null => {
  try {
    const raw = window.localStorage.getItem(WINDOW_ZOOM_KEY)
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return null
    return inRange(parsed)
  } catch {
    return null
  }
}

const writePersistedZoom = (zoom: number): void => {
  try {
    window.localStorage.setItem(WINDOW_ZOOM_KEY, String(inRange(zoom)))
  } catch {
    // Ignore localStorage failures in restricted environments.
  }
}

export async function initializeWindowZoomState(): Promise<void> {
  if (typeof window === 'undefined' || !hasTauriInternals()) {
    return
  }

  const webview = getCurrentWebview()
  const windowApi = getCurrentWindow()

  const persistedZoom = readPersistedZoom()
  if (persistedZoom !== null) {
    await webview.setZoom(persistedZoom).catch(() => undefined)
  }

  try {
    const unlisten = await windowApi.onScaleChanged(({ payload }) => {
      const scale = Number((payload as { scaleFactor?: unknown }).scaleFactor)
      if (Number.isFinite(scale)) {
        writePersistedZoom(scale)
      }
    })
    window.addEventListener('pagehide', () => {
      void unlisten()
    })
    window.addEventListener('beforeunload', () => {
      void unlisten()
    })
  } catch {
    // Ignore environments where scale-change tracking is unsupported.
  }
}

