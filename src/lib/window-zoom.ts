import { getCurrentWebview } from '@tauri-apps/api/webview'

const STORAGE_KEY = 'bento-window-zoom'
const DEFAULT_ZOOM = 1
const MIN_ZOOM = 0.5
const MAX_ZOOM = 2
const ZOOM_STEP = 0.1

let currentZoom = DEFAULT_ZOOM

function clampZoom(value: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, value))
}

function normalizeZoom(value: number): number {
  return Number(clampZoom(value).toFixed(2))
}

function readStoredZoom(): number {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (!stored) return DEFAULT_ZOOM

  const parsed = Number(stored)
  if (!Number.isFinite(parsed)) return DEFAULT_ZOOM

  return normalizeZoom(parsed)
}

async function applyWindowZoom(zoom: number): Promise<void> {
  const normalized = normalizeZoom(zoom)
  currentZoom = normalized
  localStorage.setItem(STORAGE_KEY, String(normalized))

  try {
    await getCurrentWebview().setZoom(normalized)
  } catch (error) {
    console.error('[window-zoom] Failed to apply zoom:', error)
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
  currentZoom = readStoredZoom()
  void applyWindowZoom(currentZoom)
  window.addEventListener('keydown', handleZoomShortcut)
}
