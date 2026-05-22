import { invoke } from './invoke'

export type UpdateInfo = {
  version: string
  body: string | null
  date: string | null
}

export type UpdateStatus = {
  configured: boolean
  reason: string | null
  endpointCount: number
  artifactsEnabled: boolean
}

export async function getUpdateStatus(): Promise<UpdateStatus> {
  return invoke<UpdateStatus>('get_update_status')
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  return invoke<UpdateInfo | null>('check_for_update')
}

export async function installUpdate(): Promise<void> {
  await invoke('install_update')
}
