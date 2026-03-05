/**
 * IPC protocol types for Rust <-> Node.js communication
 */

// Commands from Rust to Node
export interface BridgeCommand {
  id: string;
  type: CommandType;
  payload: unknown;
}

export type CommandType =
  | 'connect'
  | 'disconnect'
  | 'ping'
  | 'get_status'
  | 'setup_workspace'
  | 'create_thread'
  | 'archive_thread'
  | 'post_message'
  | 'update_thread_name'
  | 'agent_output'
  | 'agent_complete'
  | 'register_thread'
  | 'get_queue_status';

// Responses from Node to Rust
export interface BridgeResponse {
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

// Events from Node to Rust (no correlation ID)
export interface BridgeEvent {
  event: EventType;
  payload: unknown;
}

export type EventType =
  | 'ready'
  | 'disconnected'
  | 'error'
  | 'message_received'
  | 'guild_available';

// Specific payloads
export interface ConnectPayload {
  token: string;
  guildId?: string;
}

export interface SetupWorkspacePayload {
  guildId: string;
  workspaceName: string;
  columns: Array<{ id: string; name: string; position: number }>;
}

export interface CreateThreadPayload {
  channelId: string;
  taskId: string;
  taskTitle: string;
}

export interface PostMessagePayload {
  channelId: string;
  threadId?: string;
  content?: string;
  embeds?: Array<{
    title?: string;
    description?: string;
    color?: number;
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
    footer?: { text: string };
    timestamp?: string;
  }>;
}

export interface DiscordStatus {
  connected: boolean;
  ready: boolean;
  user?: {
    id: string;
    tag: string;
    username: string;
  };
  guildId?: string;
  guildName?: string;
}

// Agent output streaming payloads
export interface AgentOutputPayload {
  taskId: string;
  delta: string;
  type?: 'stdout' | 'stderr' | 'tool';
}

export interface AgentCompletePayload {
  taskId: string;
  success: boolean;
  summary: string;
  duration?: number;
  tokensUsed?: number;
}

export interface RegisterThreadPayload {
  taskId: string;
  threadId: string;
}

/**
 * Queue status for rate limiter monitoring
 */
export interface QueueStatus {
  pendingCount: number;
  limitedChannels: string[];
  lastError: string | null;
}
