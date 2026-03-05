/**
 * Reply handler for task thread messages
 * Routes user replies to the appropriate agent session
 */

import type { Message, ThreadChannel } from 'discord.js';
import type { Bridge } from '../bridge.js';

/**
 * Message route info from database
 */
export interface MessageRoute {
  taskId: string;
  activeSessionId: string | null;
  cliSessionId: string | null;
  lastInteractionAt: string | null;
}

/**
 * Thread mapping info
 */
export interface ThreadMapping {
  taskId: string;
  threadId: string;
  channelId: string;
}

/**
 * Creates a reply handler for task thread messages
 */
export function createReplyHandler(bridge: Bridge) {
  let typingInterval: NodeJS.Timeout | null = null;

  const startTyping = (channel: ThreadChannel) => {
    void channel.sendTyping();
    typingInterval = setInterval(() => {
      void channel.sendTyping();
    }, 5000);
  };

  const stopTyping = () => {
    if (typingInterval) {
      clearInterval(typingInterval);
      typingInterval = null;
    }
  };

  // Stop typing when agent outputs or completes
  bridge.onEvent('agent:output', () => stopTyping());
  bridge.onEvent('agent:complete', () => stopTyping());

  return async (message: Message): Promise<void> => {
    // Ignore bot messages
    if (message.author.bot) return;

    // Check if in a thread
    if (!message.channel.isThread()) return;

    // Get task mapping for this thread
    const taskMapping = await getThreadMappingByThreadId(bridge, message.channelId);
    if (!taskMapping) return; // Not a task thread

    // Get routing info
    const route = await getMessageRoute(bridge, taskMapping.taskId);

    // Show typing indicator
    startTyping(message.channel as ThreadChannel);

    try {
      if (route?.activeSessionId) {
        // Active session - forward directly
        await forwardToActiveSession(bridge, route.activeSessionId, message.content);
      } else if (route?.cliSessionId) {
        // Completed session - resume
        await resumeAgentSession(
          bridge,
          message.channel as ThreadChannel,
          taskMapping.taskId,
          route.cliSessionId,
          message.content
        );
      } else {
        // No session - start fresh agent
        await startAgentSession(
          bridge,
          message.channel as ThreadChannel,
          taskMapping.taskId,
          message.content
        );
      }
    } catch (error) {
      stopTyping();
      console.error('Reply handler error:', error);

      await message.channel.send({
        embeds: [
          {
            title: '❌ Error',
            description:
              error instanceof Error ? error.message : 'Failed to process message',
            color: 0xed4245,
          },
        ],
      });
    }
  };
}

/**
 * Get thread mapping by Discord thread ID
 */
async function getThreadMappingByThreadId(
  bridge: Bridge,
  threadId: string
): Promise<ThreadMapping | null> {
  try {
    const result = await bridge.send({
      type: 'db:get_thread_by_discord_id',
      payload: { threadId },
    });
    return result as ThreadMapping | null;
  } catch {
    return null;
  }
}

/**
 * Get message route for a task
 */
async function getMessageRoute(
  bridge: Bridge,
  taskId: string
): Promise<MessageRoute | null> {
  try {
    const result = await bridge.send({
      type: 'db:get_message_route',
      payload: { taskId },
    });
    return result as MessageRoute | null;
  } catch {
    return null;
  }
}

/**
 * Forward message to an active agent session
 */
async function forwardToActiveSession(
  bridge: Bridge,
  sessionId: string,
  content: string
): Promise<void> {
  await bridge.send({
    type: 'agent:send_message',
    payload: {
      sessionId,
      message: content,
    },
  });
}

/**
 * Resume a completed agent session
 */
async function resumeAgentSession(
  bridge: Bridge,
  thread: ThreadChannel,
  taskId: string,
  cliSessionId: string,
  userMessage: string
): Promise<void> {
  // Post acknowledgment
  await thread.send({
    embeds: [
      {
        description: '🔄 Resuming agent session...',
        color: 0x5865f2,
      },
    ],
  });

  // Call back to Rust to spawn agent with --resume
  const result = await bridge.send({
    type: 'agent:resume',
    payload: {
      taskId,
      cliSessionId,
      initialMessage: userMessage,
    },
  });

  if (result && typeof result === 'object' && 'success' in result && !result.success) {
    await thread.send({
      embeds: [
        {
          title: '❌ Failed to Resume',
          description:
            ('error' in result && typeof result.error === 'string'
              ? result.error
              : null) || 'Could not resume agent session',
          color: 0xed4245,
          footer: { text: 'Try starting a new session instead' },
        },
      ],
    });
  }
}

/**
 * Start a fresh agent session
 */
async function startAgentSession(
  bridge: Bridge,
  thread: ThreadChannel,
  taskId: string,
  userMessage: string
): Promise<void> {
  // Post acknowledgment
  await thread.send({
    embeds: [
      {
        description: '🚀 Starting agent session...',
        color: 0x5865f2,
      },
    ],
  });

  // Call back to Rust to spawn new agent
  const result = await bridge.send({
    type: 'agent:start',
    payload: {
      taskId,
      initialMessage: userMessage,
    },
  });

  if (result && typeof result === 'object' && 'success' in result && !result.success) {
    await thread.send({
      embeds: [
        {
          title: '❌ Failed to Start Agent',
          description:
            ('error' in result && typeof result.error === 'string'
              ? result.error
              : null) || 'Could not start agent session',
          color: 0xed4245,
        },
      ],
    });
  }
}
