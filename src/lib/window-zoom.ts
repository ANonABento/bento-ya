import { getCurrentWebview } from '@tauri-apps/api/webview'
import { invoke } from './ipc/invoke'

const STORAGE_KEY = 'bento-window-zoom'
const DEFAULT_ZOOM = 1
const MIN_ZOOM = 0.5
const MAX_ZOOM = 2
const ZOOM_STEP = 0.1

let currentZoom = DEFAULT_ZOOM
let initialized = false

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
}

function normalizeZoom(value: number): number {
  return Number(clampZoom(value).toFixed(2))
}

function readStoredZoom(): number {
  let stored: string | null

  try {
    stored = localStorage.getItem(STORAGE_KEY)
  } catch (error) {
    console.error('[window-zoom] Failed to read stored zoom:', error)
    return DEFAULT_ZOOM
  }

  if (!stored) return DEFAULT_ZOOM

  const parsed = Number(stored)
  if (!Number.isFinite(parsed)) return DEFAULT_ZOOM

  return normalizeZoom(parsed)
}

async function readPersistedZoom(): Promise<number | null> {
  try {
    const zoom = await invoke<number | null>('get_window_zoom')
    return zoom === null ? null : normalizeZoom(zoom)
  } catch (error) {
    console.error('[window-zoom] Failed to read persisted zoom:', error)
    return null
  }
}

async function persistZoom(zoom: number): Promise<void> {
  try {
    await invoke<number>('set_window_zoom', { zoom })
  } catch (error) {
    console.error('[window-zoom] Failed to persist zoom:', error)
  }
}

async function applyWindowZoom(zoom: number, persist = true): Promise<void> {
  const normalized = normalizeZoom(zoom)
  currentZoom = normalized

  try {
    localStorage.setItem(STORAGE_KEY, String(normalized))
  } catch (error) {
    console.error('[window-zoom] Failed to store zoom:', error)
  }

  try {
    await getCurrentWebview().setZoom(normalized)
  } catch (error) {
    console.error('[window-zoom] Failed to apply zoom:', error)
  }

  if (persist) {
    await persistZoom(normalized)
  }
}

function isZoomShortcut(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey
}

function handleZoomShortcut(event: KeyboardEvent): void {
  if (!isZoomShortcut(event)) return

  if (event.key === '+' || (event.key === '=' && !event.shiftKey)) {
    event.preventDefault()
    void applyWindowZoom(currentZoom + ZOOM_STEP)
    return
  }

  if (event.key === '-' && !event.shiftKey) {
    event.preventDefault()
    void applyWindowZoom(currentZoom - ZOOM_STEP)
    return
  }

  if (event.key === '0' && !event.shiftKey) {
    event.preventDefault()
    void applyWindowZoom(DEFAULT_ZOOM)
  }
}

export function initializeWindowZoom(): void {
  if (initialized) return

  initialized = true
  const localZoom = readStoredZoom()
  currentZoom = localZoom
  void applyWindowZoom(localZoom, false)
  void readPersistedZoom().then((persistedZoom) => {
    if (currentZoom !== localZoom) return

    if (persistedZoom === null) {
      void persistZoom(localZoom)
      return
    }

    void applyWindowZoom(persistedZoom)
  })
  window.addEventListener('keydown', handleZoomShortcut)
}
