// Orchestrator IPC commands

import { invoke, listen, type EventCallback, type UnlistenFn } from './core'
import type { Column, Task } from '@/types'

// ─── Types ─────────────────────────────────────────────────────────────────

export type ChatSession = {
  id: string
  workspaceId: string
  title: string
  createdAt: string
  updatedAt: string
}

export type ChatMessage = {
  id: string
  workspaceId: string
  sessionId: string | null
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: string
}

export type OrchestratorSession = {
  id: string
  workspaceId: string
  status: 'idle' | 'processing' | 'error'
  lastError: string | null
  createdAt: string
  updatedAt: string
}

export type OrchestratorContext = {
  workspaceId: string
  workspaceName: string
  columns: Column[]
  tasks: Task[]
  recentMessages: ChatMessage[]
}

export type OrchestratorAction = {
  actionType: string
  title?: string
  description?: string
  columnId?: string
  taskId?: string
}

export type OrchestratorResponse = {
  message: string
  actions: OrchestratorAction[]
  tasksCreated: Task[]
}

export type OrchestratorEvent = {
  workspaceId: string
  eventType: string
  message: string | null
}

export type ToolUsePayload = {
  id: string
  name: string
  input: Record<string, unknown>
}

export type StreamChunkEvent = {
  workspaceId: string
  delta: string
  finishReason: string | null
  toolUse?: ToolUsePayload
}

export type ToolResultEvent = {
  workspaceId: string
  toolUseId: string
  result: string
  isError: boolean
}

export type ThinkingEvent = {
  workspaceId: string
  content: string
  isComplete: boolean
}

export type ToolCallEvent = {
  workspaceId: string
  toolId: string
  toolName: string
  status: 'running' | 'complete' | 'error'
  input?: Record<string, unknown>
  result?: string
}

// ─── Orchestrator commands ──────────────────────────────────────────────────

export async function getOrchestratorContext(workspaceId: string): Promise<OrchestratorContext> {
  return invoke<OrchestratorContext>('get_orchestrator_context', { workspaceId })
}

export async function getOrchestratorSession(workspaceId: string): Promise<OrchestratorSession> {
  return invoke<OrchestratorSession>('get_orchestrator_session', { workspaceId })
}

export async function sendOrchestratorMessage(
  workspaceId: string,
  message: string,
): Promise<ChatMessage> {
  return invoke<ChatMessage>('send_orchestrator_message', { workspaceId, message })
}

// ─── Chat session management ────────────────────────────────────────────────

export async function listChatSessions(workspaceId: string): Promise<ChatSession[]> {
  return invoke<ChatSession[]>('list_chat_sessions', { workspaceId })
}

export async function getActiveChatSession(workspaceId: string): Promise<ChatSession> {
  return invoke<ChatSession>('get_active_chat_session', { workspaceId })
}

export async function createChatSession(workspaceId: string, title?: string): Promise<ChatSession> {
  return invoke<ChatSession>('create_chat_session', { workspaceId, title })
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  return invoke<void>('delete_chat_session', { sessionId })
}

export async function getChatHistory(
  sessionId: string,
  limit?: number,
): Promise<ChatMessage[]> {
  return invoke<ChatMessage[]>('get_chat_history', { sessionId, limit })
}

export async function clearChatHistory(sessionId: string): Promise<void> {
  return invoke<void>('clear_chat_history', { sessionId })
}

export async function processOrchestratorResponse(
  workspaceId: string,
  responseText: string,
  actions: OrchestratorAction[],
): Promise<OrchestratorResponse> {
  return invoke<OrchestratorResponse>('process_orchestrator_response', {
    workspaceId,
    responseText,
    actions,
  })
}

export async function setOrchestratorError(
  workspaceId: string,
  errorMessage: string,
): Promise<OrchestratorSession> {
  return invoke<OrchestratorSession>('set_orchestrator_error', { workspaceId, errorMessage })
}

// ─── Streaming ─────────────────────────────────────────────────────────────

export async function streamOrchestratorChat(
  workspaceId: string,
  sessionId: string,
  message: string,
  connectionMode: 'cli' | 'api',
  apiKey?: string,
  model?: string,
  cliPath?: string,
): Promise<void> {
  return invoke<void>('stream_orchestrator_chat', {
    workspaceId,
    sessionId,
    message,
    connectionMode,
    apiKey,
    model,
    cliPath,
  })
}

export async function cancelOrchestratorChat(
  sessionId: string,
  workspaceId: string
): Promise<void> {
  return invoke<void>('cancel_orchestrator_chat', { sessionId, workspaceId })
}

export async function resetCliSession(sessionId: string): Promise<void> {
  return invoke<void>('reset_cli_session', { sessionId })
}

// ─── Event listeners ───────────────────────────────────────────────────────

export const onOrchestratorProcessing = (cb: EventCallback<OrchestratorEvent>): Promise<UnlistenFn> =>
  listen<OrchestratorEvent>('orchestrator:processing', cb)
export const onOrchestratorComplete = (cb: EventCallback<OrchestratorEvent>): Promise<UnlistenFn> =>
  listen<OrchestratorEvent>('orchestrator:complete', cb)
export const onOrchestratorError = (cb: EventCallback<OrchestratorEvent>): Promise<UnlistenFn> =>
  listen<OrchestratorEvent>('orchestrator:error', cb)

// ─── Streaming event listeners ──────────────────────────────────────────────

export const onOrchestratorStream = (cb: EventCallback<StreamChunkEvent>): Promise<UnlistenFn> =>
  listen<StreamChunkEvent>('orchestrator:stream', cb)

export const onOrchestratorToolResult = (cb: EventCallback<ToolResultEvent>): Promise<UnlistenFn> =>
  listen<ToolResultEvent>('orchestrator:tool_result', cb)

export const onOrchestratorThinking = (cb: EventCallback<ThinkingEvent>): Promise<UnlistenFn> =>
  listen<ThinkingEvent>('orchestrator:thinking', cb)

export const onOrchestratorToolCall = (cb: EventCallback<ToolCallEvent>): Promise<UnlistenFn> =>
  listen<ToolCallEvent>('orchestrator:tool_call', cb)
