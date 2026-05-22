import { invoke } from './invoke'

export type RuntimePrerequisite = {
  id: string
  name: string
  required: boolean
  available: boolean
  version: string | null
  installHint: string
}

export async function checkRuntimePrerequisites(): Promise<RuntimePrerequisite[]> {
  return invoke<RuntimePrerequisite[]>('check_runtime_prerequisites')
}
