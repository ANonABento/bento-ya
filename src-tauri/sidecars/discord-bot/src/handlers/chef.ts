/**
 * Chef channel message handler
 * Routes messages from #chef to the orchestrator for board management
 */

import type { Message } from 'discord.js';
import type { Bridge } from '../bridge.js';

/**
 * Chef response from orchestrator
 */
export interface ChefResult {
  message: string;
  actions: ChefAction[];
  tasksCreated: TaskInfo[];
  tasksMoved: TaskMove[];
}

export interface ChefAction {
  type: 'create_task' | 'move_task' | 'update_task' | 'delete_task';
  taskId?: string;
  details: Record<string, unknown>;
}

export interface TaskInfo {
  id: string;
  title: string;
  description?: string;
  columnId: string;
  columnName: string;
}

export interface TaskMove {
  taskId: string;
  title: string;
  fromColumn: string;
  toColumn: string;
}

// User cooldowns for rate limiting
const userCooldowns = new Map<string, number>();
const COOLDOWN_MS = 2000; // 2 seconds between messages

// Help embed content
const HELP_EMBED = {
  title: '🍱 Bento-ya Chef',
  description: 'I can help you manage your Kanban board!',
  color: 0x5865f2,
  fields: [
    {
      name: '📋 Create Tasks',
      value: '`create a task for adding dark mode`\n`add task: fix login bug`',
    },
    {
      name: '📦 Move Tasks',
      value: '`move "Add auth" to In Progress`\n`move task 3 to Review`',
    },
    {
      name: '✏️ Update Tasks',
      value: '`rename "Old title" to "New title"`\n`add description to "Task name": ...`',
    },
    {
      name: '🔍 Query',
      value: '`show my tasks`\n`what\'s in Review?`\n`status of "Auth task"`',
    },
    {
      name: '🤖 Agents',
      value: '`start agent on "Task name"`\n`stop agent on "Task name"`',
    },
  ],
  footer: { text: 'Just chat naturally - I understand context!' },
};

/**
 * Check if user is rate limited
 */
function isRateLimited(userId: string): boolean {
  const lastMessage = userCooldowns.get(userId);
  if (lastMessage && Date.now() - lastMessage < COOLDOWN_MS) {
    return true;
  }
  userCooldowns.set(userId, Date.now());
  return false;
}

/**
 * Creates a Chef channel message handler
 */
export function createChefHandler(bridge: Bridge) {
  return async (message: Message): Promise<void> => {
    // Ignore bot messages
    if (message.author.bot) return;

    // Check if in a chef channel
    const isChefChannel = await checkIsChefChannel(bridge, message.channelId);
    if (!isChefChannel) return;

    // Check for help command
    const lowerContent = message.content.toLowerCase().trim();
    if (lowerContent === 'help' || lowerContent === '!help' || lowerContent === '/help') {
      await message.reply({ embeds: [HELP_EMBED] });
      return;
    }

    // Rate limit check
    if (isRateLimited(message.author.id)) {
      return; // Silently ignore rate-limited messages
    }

    // Get workspace for this channel
    const workspace = await getWorkspaceByChefChannel(bridge, message.channelId);
    if (!workspace) {
      await message.reply({
        embeds: [
          {
            description: '⚠️ No workspace connected to this server.',
            color: 0xfee75c,
          },
        ],
      });
      return;
    }

    // Show typing while Chef thinks
    let typingInterval: NodeJS.Timeout | null = null;
    try {
      if ('sendTyping' in message.channel) {
        await message.channel.sendTyping();
        typingInterval = setInterval(() => {
          if ('sendTyping' in message.channel) {
            void message.channel.sendTyping();
          }
        }, 5000);
      }

      // Forward to Chef orchestrator
      const result = await bridge.send({
        type: 'chef:message',
        payload: {
          workspaceId: workspace.id,
          userId: message.author.id,
          userName: message.author.displayName || message.author.username,
          message: message.content,
        },
      }) as ChefResult;

      if (typingInterval) {
        clearInterval(typingInterval);
        typingInterval = null;
      }

      // Format and send response
      await sendChefResponse(bridge, message, result);
    } catch (error) {
      if (typingInterval) {
        clearInterval(typingInterval);
        typingInterval = null;
      }

      await message.reply({
        embeds: [
          {
            title: '❌ Chef Error',
            description:
              error instanceof Error ? error.message : 'An unexpected error occurred',
            color: 0xed4245,
          },
        ],
      });
    }
  };
}

/**
 * Check if a channel is a chef channel
 */
async function checkIsChefChannel(bridge: Bridge, channelId: string): Promise<boolean> {
  try {
    const result = await bridge.send({
      type: 'db:is_chef_channel',
      payload: { channelId },
    });
    return result === true;
  } catch {
    return false;
  }
}

/**
 * Get workspace by chef channel ID
 */
async function getWorkspaceByChefChannel(
  bridge: Bridge,
  channelId: string
): Promise<{ id: string; name: string } | null> {
  try {
    const result = await bridge.send({
      type: 'db:get_workspace_by_chef_channel',
      payload: { channelId },
    });
    return result as { id: string; name: string } | null;
  } catch {
    return null;
  }
}

/**
 * Format and send Chef response
 */
async function sendChefResponse(
  bridge: Bridge,
  message: Message,
  result: ChefResult
): Promise<void> {
  const embeds: Array<{
    title?: string;
    description?: string;
    color?: number;
    fields?: Array<{ name: string; value: string; inline?: boolean }>;
  }> = [];

  // Main response embed
  const mainEmbed: {
    description: string;
    color: number;
    fields: Array<{ name: string; value: string; inline?: boolean }>;
  } = {
    description: result.message,
    color: 0x5865f2,
    fields: [],
  };

  // Add task creation details
  if (result.tasksCreated && result.tasksCreated.length > 0) {
    const taskList = result.tasksCreated
      .map((t) => `• **${t.title}** → ${t.columnName}`)
      .join('\n');

    mainEmbed.fields.push({
      name: '📋 Tasks Created',
      value: taskList,
    });
  }

  // Add move details
  if (result.tasksMoved && result.tasksMoved.length > 0) {
    const moveList = result.tasksMoved
      .map((m) => `• **${m.title}**: ${m.fromColumn} → ${m.toColumn}`)
      .join('\n');

    mainEmbed.fields.push({
      name: '📦 Tasks Moved',
      value: moveList,
    });
  }

  embeds.push(mainEmbed);

  // Add thread links for created tasks
  for (const task of result.tasksCreated || []) {
    try {
      const threadMapping = await bridge.send({
        type: 'db:get_thread_mapping',
        payload: { taskId: task.id },
      }) as { threadId: string } | null;

      if (threadMapping) {
        embeds.push({
          title: `📋 ${task.title}`,
          description: task.description || 'No description',
          color: 0x57f287,
          fields: [
            { name: 'Column', value: task.columnName, inline: true },
            { name: 'Thread', value: `<#${threadMapping.threadId}>`, inline: true },
          ],
        });
      }
    } catch {
      // Ignore thread mapping errors
    }
  }

  await message.reply({ embeds });
}
