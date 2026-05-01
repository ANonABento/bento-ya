import { invoke } from './invoke'

export type UpdateInfo = {
  version: string
  body: string | null
  date: string | null
}

export async function checkForUpdate(): Promise<UpdateInfo | null> {
  return invoke<UpdateInfo | null>('check_for_update')
}

export async function installUpdate(): Promise<void> {
  await invoke('install_update')
}
