/**
 * Discord.js client wrapper
 */

import {
  Client,
  GatewayIntentBits,
  Events,
  type Guild,
  type TextChannel,
  type ThreadChannel,
  ChannelType,
  ThreadAutoArchiveDuration,
} from 'discord.js';
import type { Bridge } from './bridge.js';
import type {
  ConnectPayload,
  SetupWorkspacePayload,
  CreateThreadPayload,
  PostMessagePayload,
  DiscordStatus,
  AgentOutputPayload,
  AgentCompletePayload,
  RegisterThreadPayload,
} from './types.js';
import { OutputBuffer } from './output-buffer.js';
import {
  splitMessage,
  formatAgentOutput,
  createCompletionEmbed,
} from './message-splitter.js';

export class DiscordClient {
  private client: Client | null = null;
  private bridge: Bridge;
  private currentGuildId: string | null = null;
  private taskThreadMap = new Map<string, string>();
  private outputBuffer: OutputBuffer;

  constructor(bridge: Bridge) {
    this.bridge = bridge;
    this.outputBuffer = new OutputBuffer(
      async (taskId, content) => {
        await this.streamOutputToThread(taskId, content);
      },
      { debounceMs: 500, maxBuffer: 4000 }
    );
  }

  /**
   * Connect to Discord with the given token
   */
  async connect(payload: ConnectPayload): Promise<DiscordStatus> {
    if (this.client) {
      await this.disconnect();
    }

    this.client = new Client({
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
      ],
    });

    // Set up event handlers
    this.client.on(Events.ClientReady, (c) => {
      this.bridge.emit('ready', {
        user: {
          id: c.user.id,
          tag: c.user.tag,
          username: c.user.username,
        },
      });
    });

    this.client.on(Events.MessageCreate, (message) => {
      // Don't emit bot messages
      if (message.author.bot) return;

      this.bridge.emit('message_received', {
        id: message.id,
        channelId: message.channelId,
        guildId: message.guildId,
        content: message.content,
        author: {
          id: message.author.id,
          tag: message.author.tag,
          username: message.author.username,
        },
        isThread: message.channel.isThread(),
        threadId: message.channel.isThread() ? message.channelId : null,
        parentChannelId: message.channel.isThread()
          ? (message.channel as ThreadChannel).parentId
          : null,
      });
    });

    this.client.on(Events.Error, (error) => {
      this.bridge.emit('error', { message: error.message });
    });

    this.client.on(Events.GuildAvailable, (guild) => {
      this.bridge.emit('guild_available', {
        id: guild.id,
        name: guild.name,
      });
    });

    // Login
    await this.client.login(payload.token);

    if (payload.guildId) {
      this.currentGuildId = payload.guildId;
    }

    return this.getStatus();
  }

  /**
   * Disconnect from Discord
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      this.client.destroy();
      this.client = null;
      this.currentGuildId = null;
    }
  }

  /**
   * Get current connection status
   */
  getStatus(): DiscordStatus {
    if (!this.client || !this.client.isReady()) {
      return { connected: false, ready: false };
    }

    const guild = this.currentGuildId
      ? this.client.guilds.cache.get(this.currentGuildId)
      : null;

    return {
      connected: true,
      ready: true,
      user: {
        id: this.client.user.id,
        tag: this.client.user.tag,
        username: this.client.user.username,
      },
      guildId: this.currentGuildId ?? undefined,
      guildName: guild?.name,
    };
  }

  /**
   * Ping/pong test
   */
  ping(): { pong: true; timestamp: number; latency: number | null } {
    return {
      pong: true,
      timestamp: Date.now(),
      latency: this.client?.ws.ping ?? null,
    };
  }

  /**
   * Set up Discord server structure for a workspace
   */
  async setupWorkspace(payload: SetupWorkspacePayload): Promise<{
    categoryId: string;
    channelMap: Record<string, string>;
    chefChannelId: string;
    notificationsChannelId: string;
  }> {
    if (!this.client?.isReady()) {
      throw new Error('Client not ready');
    }

    const guild = await this.client.guilds.fetch(payload.guildId);
    if (!guild) {
      throw new Error(`Guild ${payload.guildId} not found`);
    }

    // Create category for workspace
    const category = await guild.channels.create({
      name: `🍱 ${payload.workspaceName}`,
      type: ChannelType.GuildCategory,
    });

    // Create column channels
    const channelMap: Record<string, string> = {};
    const sortedColumns = [...payload.columns].sort(
      (a, b) => a.position - b.position
    );

    for (const col of sortedColumns) {
      const channelName = this.slugify(col.name);
      const channel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: category.id,
      });
      channelMap[col.id] = channel.id;
    }

    // Create special channels
    const chefChannel = await guild.channels.create({
      name: 'chef',
      type: ChannelType.GuildText,
      parent: category.id,
      topic:
        'Talk to Chef to manage your board. Try: "create a task for adding dark mode"',
    });

    const notifChannel = await guild.channels.create({
      name: 'notifications',
      type: ChannelType.GuildText,
      parent: category.id,
      topic: 'Task completions, alerts, and daily summaries',
    });

    this.currentGuildId = payload.guildId;

    return {
      categoryId: category.id,
      channelMap,
      chefChannelId: chefChannel.id,
      notificationsChannelId: notifChannel.id,
    };
  }

  /**
   * Create a thread for a task
   */
  async createThread(payload: CreateThreadPayload): Promise<{
    threadId: string;
    messageId: string;
  }> {
    if (!this.client?.isReady()) {
      throw new Error('Client not ready');
    }

    const channel = (await this.client.channels.fetch(
      payload.channelId
    )) as TextChannel | null;
    if (!channel || !channel.isTextBased()) {
      throw new Error(`Channel ${payload.channelId} not found or not text-based`);
    }

    // Create starter message
    const starterMessage = await channel.send({
      embeds: [
        {
          title: `📋 ${payload.taskTitle}`,
          description: 'Task thread created. Agent updates will appear here.',
          color: 0x5865f2,
        },
      ],
    });

    // Create thread from message
    const thread = await starterMessage.startThread({
      name: payload.taskTitle.slice(0, 100),
      autoArchiveDuration: ThreadAutoArchiveDuration.OneWeek,
    });

    return {
      threadId: thread.id,
      messageId: starterMessage.id,
    };
  }

  /**
   * Archive a thread
   */
  async archiveThread(
    threadId: string,
    reason?: string
  ): Promise<{ archived: boolean }> {
    if (!this.client?.isReady()) {
      throw new Error('Client not ready');
    }

    const thread = (await this.client.channels.fetch(
      threadId
    )) as ThreadChannel | null;
    if (!thread || !thread.isThread()) {
      throw new Error(`Thread ${threadId} not found`);
    }

    if (reason) {
      await thread.send({
        embeds: [
          {
            description: `📦 ${reason}`,
            color: 0xfee75c,
          },
        ],
      });
    }

    await thread.setArchived(true);
    return { archived: true };
  }

  /**
   * Post a message to a channel or thread
   */
  async postMessage(payload: PostMessagePayload): Promise<{ messageId: string }> {
    if (!this.client?.isReady()) {
      throw new Error('Client not ready');
    }

    const targetId = payload.threadId || payload.channelId;
    const channel = (await this.client.channels.fetch(targetId)) as
      | TextChannel
      | ThreadChannel
      | null;

    if (!channel || !('send' in channel)) {
      throw new Error(`Channel ${targetId} not found or cannot send messages`);
    }

    const message = await channel.send({
      content: payload.content || undefined,
      embeds: payload.embeds,
    });

    return { messageId: message.id };
  }

  /**
   * Update thread name
   */
  async updateThreadName(
    threadId: string,
    name: string
  ): Promise<{ updated: boolean }> {
    if (!this.client?.isReady()) {
      throw new Error('Client not ready');
    }

    const thread = (await this.client.channels.fetch(
      threadId
    )) as ThreadChannel | null;
    if (!thread || !thread.isThread()) {
      throw new Error(`Thread ${threadId} not found`);
    }

    await thread.setName(name.slice(0, 100));
    return { updated: true };
  }

  // ─── Agent Output Streaming ─────────────────────────────────────────────────

  /**
   * Register a thread ID for a task (for output streaming)
   */
  registerThread(payload: RegisterThreadPayload): { registered: boolean } {
    this.taskThreadMap.set(payload.taskId, payload.threadId);
    return { registered: true };
  }

  /**
   * Stream agent output to the task's Discord thread
   */
  async handleAgentOutput(payload: AgentOutputPayload): Promise<{ queued: boolean }> {
    const formatted = formatAgentOutput(payload.delta, payload.type || 'stdout');
    this.outputBuffer.append(payload.taskId, formatted);
    return { queued: true };
  }

  /**
   * Handle agent completion - flush output and post summary
   */
  async handleAgentComplete(
    payload: AgentCompletePayload
  ): Promise<{ completed: boolean }> {
    // Flush any remaining output
    await this.outputBuffer.flushAll(payload.taskId);

    // Post completion embed to thread
    const threadId = this.taskThreadMap.get(payload.taskId);
    if (threadId && this.client?.isReady()) {
      try {
        const thread = (await this.client.channels.fetch(
          threadId
        )) as ThreadChannel | null;

        if (thread && thread.isThread()) {
          const embed = createCompletionEmbed(
            payload.taskId,
            payload.success,
            payload.summary,
            payload.duration,
            payload.tokensUsed
          );
          await thread.send({ embeds: [embed] });
        }
      } catch (error) {
        console.error('Failed to post completion embed:', error);
      }
    }

    // Clean up
    this.taskThreadMap.delete(payload.taskId);
    return { completed: true };
  }

  /**
   * Stream output content to a task's thread
   */
  private async streamOutputToThread(
    taskId: string,
    content: string
  ): Promise<void> {
    const threadId = this.taskThreadMap.get(taskId);
    if (!threadId || !this.client?.isReady()) return;

    try {
      const thread = (await this.client.channels.fetch(
        threadId
      )) as ThreadChannel | null;

      if (!thread || !thread.isThread()) return;

      // Split content if too long
      const chunks = splitMessage(content);

      for (const chunk of chunks) {
        await thread.send(chunk);
      }
    } catch (error) {
      console.error('Failed to stream output:', error);
    }
  }

  /**
   * Convert string to Discord channel name format
   */
  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .slice(0, 100);
  }
}
