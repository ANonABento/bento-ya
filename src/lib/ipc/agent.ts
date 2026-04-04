import { invoke, listen, type EventCallback, type UnlistenFn } from './invoke'
import type { Task, AgentMessage } from '@/types'

// ─── Agent commands ───────────────────────────────────────────────────────

export type AgentInfo = {
  taskId: string
  agentType: string
  status: string
  pid: number | null
  workingDir: string
}

export async function startAgent(
  taskId: string,
  agentType: string,
  workingDir: string,
  cliPath?: string,
): Promise<AgentInfo> {
  return invoke<AgentInfo>('start_agent', { taskId, agentType, workingDir, cliPath })
}

export async function stopAgent(taskId: string): Promise<void> {
  return invoke('stop_agent', { taskId })
}

export async function getAgentStatus(taskId: string): Promise<AgentInfo> {
  return invoke<AgentInfo>('get_agent_status', { taskId })
}

// ─── Agent Messages ────────────────────────────────────────────────────────

export async function saveAgentMessage(
  taskId: string,
  role: string,
  content: string,
  model?: string,
  effortLevel?: string,
  toolCalls?: string,
  thinkingContent?: string,
): Promise<AgentMessage> {
  return invoke<AgentMessage>('save_agent_message', {
    taskId,
    role,
    content,
    model,
    effortLevel,
    toolCalls,
    thinkingContent,
  })
}

export async function getAgentMessages(taskId: string): Promise<AgentMessage[]> {
  return invoke<AgentMessage[]>('get_agent_messages', { taskId })
}

export async function clearAgentMessages(taskId: string): Promise<void> {
  return invoke('clear_agent_messages', { taskId })
}

export async function streamAgentChat(
  taskId: string,
  message: string,
  workingDir: string,
  cliPath: string,
  model?: string,
  effortLevel?: string,
): Promise<void> {
  return invoke('stream_agent_chat', {
    taskId,
    message,
    workingDir,
    cliPath,
    model,
    effortLevel,
  })
}

export async function cancelAgentChat(taskId: string): Promise<void> {
  return invoke('cancel_agent_chat', { taskId })
}

// ─── Queue Management ──────────────────────────────────────────────────────

export type QueueStatus = {
  queuedCount: number
  runningCount: number
  maxConcurrent: number
  queuedTasks: Task[]
}

export async function queueAgentTasks(taskIds: string[]): Promise<Task[]> {
  return invoke<Task[]>('queue_agent_tasks', { taskIds })
}

export async function updateTaskAgentStatus(
  taskId: string,
  agentStatus: string | null,
  queuedAt?: string | null
): Promise<Task> {
  return invoke<Task>('update_task_agent_status', { taskId, agentStatus, queuedAt })
}

export async function getQueueStatus(workspaceId: string): Promise<QueueStatus> {
  return invoke<QueueStatus>('get_queue_status', { workspaceId })
}

export async function getNextQueuedTask(workspaceId: string): Promise<Task | null> {
  return invoke<Task | null>('get_next_queued_task', { workspaceId })
}

// ─── Agent Events ──────────────────────────────────────────────────────────

export type AgentStreamEvent = {
  taskId: string
  content: string
}

export type AgentThinkingEvent = {
  taskId: string
  content: string
  isComplete: boolean
}

export type AgentToolCallEvent = {
  taskId: string
  toolId: string
  toolName: string
  toolInput: string
  status: 'pending' | 'running' | 'completed' | 'error'
}

export type AgentCompleteEvent = {
  taskId: string
  success: boolean
  message?: string
}

export const onAgentStream = (
  cb: EventCallback<AgentStreamEvent>
): Promise<UnlistenFn> => listen<AgentStreamEvent>('agent:stream', cb)

export const onAgentThinking = (
  cb: EventCallback<AgentThinkingEvent>
): Promise<UnlistenFn> => listen<AgentThinkingEvent>('agent:thinking', cb)

export const onAgentToolCall = (
  cb: EventCallback<AgentToolCallEvent>
): Promise<UnlistenFn> => listen<AgentToolCallEvent>('agent:tool_call', cb)

export const onAgentComplete = (
  cb: EventCallback<AgentCompleteEvent>
): Promise<UnlistenFn> => listen<AgentCompleteEvent>('agent:complete', cb)

// ─── Queue Events ──────────────────────────────────────────────────────────

export type QueueBatchRequestedEvent = {
  workspaceId: string
  taskIds: string[]
  agentType: string
}

export const onQueueBatchRequested = (
  cb: EventCallback<QueueBatchRequestedEvent>
): Promise<UnlistenFn> => listen<QueueBatchRequestedEvent>('queue:batch_requested', cb)

// Maximum concurrent agents for batch processing
const MAX_CONCURRENT_AGENTS = 5

// Active agent tracking for batch queue
const activeAgentSlots = new Set<string>()

/**
 * Queue multiple tasks for batch agent processing.
 * Respects MAX_CONCURRENT_AGENTS limit and processes in parallel.
 */
export async function queueAgentBatch(
  taskIds: string[],
  agentType: string,
  workingDir: string,
  cliPath?: string
): Promise<{ queued: string[]; skipped: string[] }> {
  const queued: string[] = []
  const skipped: string[] = []

  for (const taskId of taskIds) {
    // Check if we have available slots
    if (activeAgentSlots.size >= MAX_CONCURRENT_AGENTS) {
      skipped.push(taskId)
      continue
    }

    // Check if this task already has an active agent
    if (activeAgentSlots.has(taskId)) {
      skipped.push(taskId)
      continue
    }

    try {
      activeAgentSlots.add(taskId)
      await startAgent(taskId, agentType, workingDir, cliPath)
      queued.push(taskId)
    } catch (err) {
      activeAgentSlots.delete(taskId)
      console.error(`[queueAgentBatch] Failed to start agent for ${taskId}:`, err)
      skipped.push(taskId)
    }
  }

  return { queued, skipped }
}

/**
 * Release an agent slot when processing completes.
 * Should be called when an agent finishes (success or failure).
 */
export function releaseAgentSlot(taskId: string): void {
  activeAgentSlots.delete(taskId)
}

/**
 * Get current number of active agent slots.
 */
export function getActiveAgentCount(): number {
  return activeAgentSlots.size
}
