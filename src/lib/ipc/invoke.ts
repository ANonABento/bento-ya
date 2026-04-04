// Typed invoke() and listen() wrappers for Tauri IPC.
// Provides type-safe communication between React frontend and Rust backend.
// Falls back to browser mocks when Tauri is not available (E2E testing).

import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { listen as tauriListen, type UnlistenFn } from '@tauri-apps/api/event'
import { isTauri, mockInvoke, mockListen } from '../browser-mock'

// ─── Typed invoke wrapper ──────────────────────────────────────────────────

export async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (isTauri()) {
    return tauriInvoke<T>(cmd, args)
  }
  // Browser mode - use mocks
  return mockInvoke<T>(cmd, args)
}

// ─── Typed listen wrapper ──────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- T propagates to tauriListen
export function listen<T>(event: string, handler: (payload: T) => void): Promise<UnlistenFn> {
  if (isTauri()) {
    return tauriListen<T>(event, (e) => { handler(e.payload); })
  }
  // Browser mode - events not supported
  return mockListen<T>(event, handler)
}

export type EventCallback<T> = (payload: T) => void

export type { UnlistenFn }
