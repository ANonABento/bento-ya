import { getCurrentWebview } from '@tauri-apps/api/webview'

const WINDOW_ZOOM_KEY = 'bento-window-zoom'
const MIN_ZOOM = 0.2
const MAX_ZOOM = 5
const ZOOM_STEP = 0.1

const normalizeZoom = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    return 1
  }
  const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value))
  return Math.round(clamped * 100) / 100
}

const hasTauriInternals = (): boolean =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window

let cleanupWindowZoomState: (() => void) | null = null

const readPersistedZoom = (): number | null => {
  try {
    const raw = window.localStorage.getItem(WINDOW_ZOOM_KEY)
    if (raw === null || raw.trim() === '') return null
    const parsed = Number(raw)
    if (!Number.isFinite(parsed)) return null
    return normalizeZoom(parsed)
  } catch {
    return null
  }
}

const writePersistedZoom = (zoom: number): void => {
  try {
    window.localStorage.setItem(WINDOW_ZOOM_KEY, String(normalizeZoom(zoom)))
  } catch {
    // Ignore localStorage failures in restricted environments.
  }
}

const getShortcutZoom = (event: KeyboardEvent, currentZoom: number): number | null => {
  if (!(event.metaKey || event.ctrlKey) || event.altKey) {
    return null
  }

  switch (event.key) {
    case '+':
    case '=':
      return currentZoom + ZOOM_STEP
    case '-':
    case '_':
      return currentZoom - ZOOM_STEP
    case '0':
      return 1
    default:
      return null
  }
}

export async function initializeWindowZoomState(): Promise<void> {
  if (typeof window === 'undefined' || !hasTauriInternals()) {
    return
  }

  cleanupWindowZoomState?.()
  cleanupWindowZoomState = null

  const webview = getCurrentWebview()
  const persistedZoom = readPersistedZoom()
  let currentZoom = persistedZoom ?? 1
  let zoomQueue = Promise.resolve()

  const applyZoom = (zoom: number): Promise<void> => {
    const nextZoom = normalizeZoom(zoom)
    currentZoom = nextZoom

    const setAndPersist = async (): Promise<void> => {
      await webview.setZoom(nextZoom)
      writePersistedZoom(nextZoom)
    }

    zoomQueue = zoomQueue.then(setAndPersist, setAndPersist)
    return zoomQueue
  }

  if (persistedZoom !== null) {
    await applyZoom(persistedZoom).catch(() => undefined)
  }

  const handleKeyDown = (event: KeyboardEvent): void => {
    const nextZoom = getShortcutZoom(event, currentZoom)
    if (nextZoom === null) return

    event.preventDefault()
    void applyZoom(nextZoom).catch(() => undefined)
  }

  window.addEventListener('keydown', handleKeyDown)

  const cleanup = (): void => {
    window.removeEventListener('keydown', handleKeyDown)
    window.removeEventListener('pagehide', cleanup)
    window.removeEventListener('beforeunload', cleanup)
    if (cleanupWindowZoomState === cleanup) {
      cleanupWindowZoomState = null
    }
  }

  cleanupWindowZoomState = cleanup
  window.addEventListener('pagehide', cleanup)
  window.addEventListener('beforeunload', cleanup)
}
