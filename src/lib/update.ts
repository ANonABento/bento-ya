import { checkForAppUpdate, installAppUpdate, type AppUpdateMetadata } from './ipc'

export type AppUpdateResult = AppUpdateMetadata

export function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function checkUpdateIfAvailable(): Promise<AppUpdateResult | null> {
  if (!isTauriRuntime()) {
    return null
  }

  return checkForAppUpdate()
}

export async function installPendingUpdate(): Promise<void> {
  if (!isTauriRuntime()) {
    return Promise.reject(new Error('Updates are only available in the desktop app'))
  }

  return installAppUpdate()
}
