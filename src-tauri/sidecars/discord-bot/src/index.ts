/**
 * Discord bot sidecar entry point
 *
 * Communicates with Bento-ya Rust backend via stdin/stdout JSON IPC.
 */

import { Bridge } from './bridge.js';
import { DiscordClient } from './client.js';
import type {
  ConnectPayload,
  SetupWorkspacePayload,
  CreateThreadPayload,
  PostMessagePayload,
} from './types.js';

// Create IPC bridge
const bridge = new Bridge();

// Create Discord client
const discord = new DiscordClient(bridge);

// Register command handlers
bridge.on('connect', async (payload) => {
  return await discord.connect(payload as ConnectPayload);
});

bridge.on('disconnect', async () => {
  await discord.disconnect();
  return { disconnected: true };
});

bridge.on('ping', async () => {
  return discord.ping();
});

bridge.on('get_status', async () => {
  return discord.getStatus();
});

bridge.on('setup_workspace', async (payload) => {
  return await discord.setupWorkspace(payload as SetupWorkspacePayload);
});

bridge.on('create_thread', async (payload) => {
  return await discord.createThread(payload as CreateThreadPayload);
});

bridge.on('archive_thread', async (payload) => {
  const { threadId, reason } = payload as { threadId: string; reason?: string };
  return await discord.archiveThread(threadId, reason);
});

bridge.on('post_message', async (payload) => {
  return await discord.postMessage(payload as PostMessagePayload);
});

bridge.on('update_thread_name', async (payload) => {
  const { threadId, name } = payload as { threadId: string; name: string };
  return await discord.updateThreadName(threadId, name);
});

// Signal ready
bridge.emit('ready', { sidecar: 'discord-bot', version: '1.0.0' });

// Handle graceful shutdown
process.on('SIGINT', () => {
  discord.disconnect().then(() => process.exit(0));
});

process.on('SIGTERM', () => {
  discord.disconnect().then(() => process.exit(0));
});
