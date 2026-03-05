/**
 * Message splitter for Discord's 2000 character limit
 * Intelligently splits messages while preserving code blocks
 */

const DISCORD_MAX_LENGTH = 2000;
const SAFETY_MARGIN = 50; // Buffer for markdown formatting
const MAX_CHUNK_LENGTH = DISCORD_MAX_LENGTH - SAFETY_MARGIN;

/**
 * Split a message into chunks that fit Discord's limit
 * Preserves code block integrity where possible
 */
export function splitMessage(content: string): string[] {
  if (content.length <= MAX_CHUNK_LENGTH) {
    return [content];
  }

  const chunks: string[] = [];
  let remaining = content;

  while (remaining.length > 0) {
    if (remaining.length <= MAX_CHUNK_LENGTH) {
      chunks.push(remaining);
      break;
    }

    // Find a good split point
    const chunk = remaining.slice(0, MAX_CHUNK_LENGTH);
    const splitIndex = findSplitPoint(chunk, remaining);

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex);
  }

  return chunks.map((chunk, index) => {
    // Add continuation markers for multi-chunk messages
    if (chunks.length > 1) {
      const marker = `\`[${index + 1}/${chunks.length}]\``;
      if (index === 0) {
        return chunk + '\n' + marker;
      } else if (index === chunks.length - 1) {
        return marker + '\n' + chunk;
      } else {
        return marker + '\n' + chunk + '\n' + marker;
      }
    }
    return chunk;
  });
}

/**
 * Find the best point to split content
 * Priority: code block end > newline > space > arbitrary
 */
function findSplitPoint(chunk: string, full: string): number {
  const maxLen = chunk.length;

  // Check if we're in a code block
  const codeBlockState = getCodeBlockState(chunk);

  if (codeBlockState.inBlock) {
    // Try to find the end of this code block within reasonable distance
    const searchEnd = Math.min(full.length, maxLen + 500);
    const searchArea = full.slice(0, searchEnd);
    const closeIndex = findCodeBlockClose(searchArea, codeBlockState.startIndex);

    if (closeIndex !== -1 && closeIndex <= maxLen + 200) {
      // Include the closing ``` and split after
      return closeIndex + 3;
    }

    // Can't find close, split at a newline within the code block
    const lastNewline = chunk.lastIndexOf('\n');
    if (lastNewline > maxLen * 0.5) {
      return lastNewline + 1;
    }
  }

  // Not in code block or couldn't find good code block split
  // Try to split at paragraph (double newline)
  const lastParagraph = chunk.lastIndexOf('\n\n');
  if (lastParagraph > maxLen * 0.5) {
    return lastParagraph + 2;
  }

  // Try to split at single newline
  const lastNewline = chunk.lastIndexOf('\n');
  if (lastNewline > maxLen * 0.5) {
    return lastNewline + 1;
  }

  // Try to split at space
  const lastSpace = chunk.lastIndexOf(' ');
  if (lastSpace > maxLen * 0.7) {
    return lastSpace + 1;
  }

  // Last resort: split at max length
  return maxLen;
}

interface CodeBlockState {
  inBlock: boolean;
  startIndex: number;
}

/**
 * Determine if we're currently inside a code block
 */
function getCodeBlockState(content: string): CodeBlockState {
  let inBlock = false;
  let startIndex = -1;

  const codeBlockRegex = /```/g;
  let match;

  while ((match = codeBlockRegex.exec(content)) !== null) {
    if (!inBlock) {
      inBlock = true;
      startIndex = match.index;
    } else {
      inBlock = false;
      startIndex = -1;
    }
  }

  return { inBlock, startIndex };
}

/**
 * Find the closing ``` for a code block
 */
function findCodeBlockClose(content: string, afterIndex: number): number {
  const searchStart = afterIndex + 3; // Skip the opening ```
  const closeIndex = content.indexOf('```', searchStart);
  return closeIndex;
}

/**
 * Format output for Discord with syntax highlighting
 */
export function formatAgentOutput(
  output: string,
  type: 'stdout' | 'stderr' | 'tool'
): string {
  const prefix = type === 'stderr' ? '⚠️ ' : type === 'tool' ? '🔧 ' : '';

  // Detect if output looks like code and isn't already wrapped
  const hasCodeIndicators =
    output.includes('function ') ||
    output.includes('const ') ||
    output.includes('import ') ||
    output.includes('=>') ||
    output.includes('```');

  if (hasCodeIndicators && !output.includes('```')) {
    // Wrap in code block
    return `${prefix}\`\`\`\n${output}\n\`\`\``;
  }

  return prefix + output;
}

/**
 * Create a completion summary embed
 */
export function createCompletionEmbed(
  taskId: string,
  success: boolean,
  summary: string,
  duration?: number,
  tokensUsed?: number
): {
  title: string;
  description: string;
  color: number;
  fields: Array<{ name: string; value: string; inline: boolean }>;
  footer: { text: string };
  timestamp: string;
} {
  const color = success ? 0x57f287 : 0xed4245; // Green or red
  const emoji = success ? '✅' : '❌';

  const fields: Array<{ name: string; value: string; inline: boolean }> = [];

  if (duration !== undefined) {
    const minutes = Math.floor(duration / 60000);
    const seconds = Math.floor((duration % 60000) / 1000);
    fields.push({
      name: '⏱️ Duration',
      value: minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`,
      inline: true,
    });
  }

  if (tokensUsed !== undefined) {
    fields.push({
      name: '🎟️ Tokens',
      value: tokensUsed.toLocaleString(),
      inline: true,
    });
  }

  return {
    title: `${emoji} Agent ${success ? 'Completed' : 'Failed'}`,
    description: summary.slice(0, 2000),
    color,
    fields,
    footer: {
      text: `Task: ${taskId}`,
    },
    timestamp: new Date().toISOString(),
  };
}
