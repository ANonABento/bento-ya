import { invoke } from './invoke'

export type AppUpdateMetadata = {
  version: string
  currentVersion: string
  body: string | null
  date: string | null
}

export async function checkForAppUpdate(): Promise<AppUpdateMetadata | null> {
  return invoke<AppUpdateMetadata | null>('check_app_update')
}

export async function installAppUpdate(): Promise<void> {
  return invoke('install_app_update')
}
