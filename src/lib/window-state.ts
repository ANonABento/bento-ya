import { getCurrentWebview } from '@tauri-apps/api/webview'

const WINDOW_ZOOM_KEY = 'bento-window-zoom'
const MIN_ZOOM = 0.2
const MAX_ZOOM = 5
const ZOOM_STEP = 0.1

const inRange = (value: number): number => {
  if (!Number.isFinite(value) || value <= 0) {
    return 1
  }
  const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value))
  return Math.round(clamped * 100) / 100
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

  const webview = getCurrentWebview()
  let currentZoom = readPersistedZoom() ?? 1

  const applyZoom = async (zoom: number): Promise<void> => {
    currentZoom = inRange(zoom)
    await webview.setZoom(currentZoom)
    writePersistedZoom(currentZoom)
  }

  const persistedZoom = readPersistedZoom()
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
  }

  window.addEventListener('pagehide', cleanup, { once: true })
  window.addEventListener('beforeunload', cleanup, { once: true })
}
