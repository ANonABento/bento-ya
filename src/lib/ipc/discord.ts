import { invoke, listen, type EventCallback, type UnlistenFn } from './invoke'

// ─── Discord commands ─────────────────────────────────────────────────────────

export type DiscordStatus = {
  connected: boolean
  ready: boolean
  user?: {
    id: string
    tag: string
    username: string
  }
  guildId?: string
  guildName?: string
}

export type SetupWorkspaceResult = {
  categoryId: string
  channelMap: Record<string, string>
  chefChannelId: string
  notificationsChannelId: string
}

export type CreateThreadResult = {
  threadId: string
  messageId: string
}

export type DiscordTaskThread = {
  id: string
  taskId: string
  discordThreadId: string
  discordChannelId: string
  isArchived: boolean
  createdAt: string
}

export async function spawnDiscordSidecar(): Promise<void> {
  return invoke('spawn_discord_sidecar')
}

export async function killDiscordSidecar(): Promise<void> {
  return invoke('kill_discord_sidecar')
}

export async function connectDiscord(
  token: string,
  guildId?: string,
): Promise<DiscordStatus> {
  return invoke<DiscordStatus>('connect_discord', { token, guildId })
}

export async function disconnectDiscord(): Promise<void> {
  return invoke('disconnect_discord')
}

export async function getDiscordStatus(): Promise<DiscordStatus> {
  return invoke<DiscordStatus>('get_discord_status')
}

export async function testDiscordConnection(): Promise<unknown> {
  return invoke<unknown>('test_discord_connection')
}

export async function setupDiscordWorkspace(
  workspaceId: string,
  guildId: string,
): Promise<SetupWorkspaceResult> {
  return invoke<SetupWorkspaceResult>('setup_discord_workspace', { workspaceId, guildId })
}

export async function createDiscordThread(
  channelId: string,
  taskId: string,
  taskTitle: string,
): Promise<CreateThreadResult> {
  return invoke<CreateThreadResult>('create_discord_thread', { channelId, taskId, taskTitle })
}

export async function archiveDiscordThread(
  taskId: string,
  reason?: string,
): Promise<boolean> {
  return invoke<boolean>('archive_discord_thread', { taskId, reason })
}

export async function getDiscordThreadForTask(
  taskId: string,
): Promise<DiscordTaskThread | null> {
  return invoke<DiscordTaskThread | null>('get_discord_thread_for_task', { taskId })
}

export async function postDiscordMessage(
  channelId: string,
  threadId?: string,
  content?: string,
  embeds?: unknown[],
): Promise<string> {
  return invoke<string>('post_discord_message', { channelId, threadId, content, embeds })
}

// Discord task sync commands
export async function syncTaskCreated(
  taskId: string,
  workspaceId: string,
  columnId: string,
  title: string,
  description?: string,
): Promise<CreateThreadResult | null> {
  return invoke<CreateThreadResult | null>('sync_task_created', {
    taskId, workspaceId, columnId, title, description,
  })
}

export async function syncTaskMoved(
  taskId: string,
  workspaceId: string,
  oldColumnId: string,
  newColumnId: string,
  title: string,
): Promise<CreateThreadResult | null> {
  return invoke<CreateThreadResult | null>('sync_task_moved', {
    taskId, workspaceId, oldColumnId, newColumnId, title,
  })
}

export async function syncTaskUpdated(
  taskId: string,
  workspaceId: string,
  newTitle: string,
): Promise<boolean> {
  return invoke<boolean>('sync_task_updated', { taskId, workspaceId, newTitle })
}

export async function syncTaskDeleted(
  taskId: string,
  workspaceId: string,
  title: string,
): Promise<boolean> {
  return invoke<boolean>('sync_task_deleted', { taskId, workspaceId, title })
}

// Discord agent streaming commands
export async function registerDiscordThread(
  taskId: string,
  threadId: string,
): Promise<void> {
  return invoke('register_discord_thread', { taskId, threadId })
}

export async function streamAgentOutput(
  taskId: string,
  delta: string,
  outputType?: string,
): Promise<void> {
  return invoke('stream_agent_output', { taskId, delta, outputType })
}

export async function signalAgentComplete(
  taskId: string,
  success: boolean,
  summary: string,
  durationMs?: number,
  tokensUsed?: number,
): Promise<void> {
  return invoke('signal_agent_complete', { taskId, success, summary, durationMs, tokensUsed })
}

// Discord queue status
export type DiscordQueueStatus = {
  pendingCount: number
  limitedChannels: string[]
  lastError: string | null
}

export async function getDiscordQueueStatus(): Promise<DiscordQueueStatus> {
  return invoke<DiscordQueueStatus>('get_discord_queue_status')
}

// Discord event listeners
export type DiscordEvent = {
  event: string
  payload: unknown
}

export const onDiscordEvent = (cb: EventCallback<DiscordEvent>): Promise<UnlistenFn> =>
  listen<DiscordEvent>('discord:event', cb)
