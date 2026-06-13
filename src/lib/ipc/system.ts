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

/** One recorded CLI chat turn — what we sent and what came back. */
export type ChatDebugTurn = {
  id: number
  startedAtMs: number
  command: string
  args: string[]
  stdin: string | null
  output: string[]
  outputTruncated: boolean
}

export async function getChatDebug(): Promise<ChatDebugTurn[]> {
  return invoke<ChatDebugTurn[]>('get_chat_debug')
}

export async function clearChatDebug(): Promise<void> {
  return invoke('clear_chat_debug')
}
