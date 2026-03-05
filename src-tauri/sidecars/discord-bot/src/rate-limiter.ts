/**
 * Token bucket rate limiter for Discord API
 * Prevents hitting rate limits by queuing messages and sending at safe intervals
 */

/**
 * Message priority levels
 * Lower number = higher priority
 */
export enum Priority {
  COMPLETION = 0, // Highest priority - completion embeds
  STATUS = 1, // Medium priority - status updates
  OUTPUT = 2, // Lowest priority - streaming output
}

/**
 * Message payload for rate-limited sending
 */
export interface MessagePayload {
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

interface QueuedMessage {
  channelId: string;
  payload: MessagePayload;
  priority: Priority;
  timestamp: number;
}

type SendFunction = (channelId: string, payload: MessagePayload) => Promise<void>;

/**
 * Rate limiter using token bucket algorithm
 * 5 messages per 5 seconds per channel (Discord's rate limit)
 */
export class RateLimiter {
  private readonly maxTokens = 5;
  private readonly refillInterval = 5000; // 5 seconds in ms
  private readonly refillAmount = 5;

  private tokens = new Map<string, number>(); // channelId -> available tokens
  private lastRefill = new Map<string, number>(); // channelId -> last refill timestamp
  private queues = new Map<string, QueuedMessage[]>(); // channelId -> queued messages
  private processing = new Set<string>(); // channels currently being processed
  private lastError: string | null = null;

  private sendFn: SendFunction;

  constructor(sendFn: SendFunction) {
    this.sendFn = sendFn;
  }

  /**
   * Queue a message for rate-limited sending
   */
  async send(
    channelId: string,
    payload: MessagePayload,
    priority: Priority = Priority.OUTPUT
  ): Promise<void> {
    const message: QueuedMessage = {
      channelId,
      payload,
      priority,
      timestamp: Date.now(),
    };

    // Initialize channel state if needed
    if (!this.tokens.has(channelId)) {
      this.tokens.set(channelId, this.maxTokens);
      this.lastRefill.set(channelId, Date.now());
      this.queues.set(channelId, []);
    }

    // Add to queue sorted by priority
    const queue = this.queues.get(channelId)!;
    queue.push(message);
    queue.sort((a, b) => a.priority - b.priority);

    // Combine similar output messages if queue is backed up
    if (queue.length > 3) {
      this.combineOutputMessages(queue);
    }

    // Start processing if not already
    if (!this.processing.has(channelId)) {
      void this.processQueue(channelId);
    }
  }

  /**
   * Combine consecutive OUTPUT priority messages to reduce API calls
   */
  private combineOutputMessages(queue: QueuedMessage[]): void {
    const combined: QueuedMessage[] = [];
    let currentBatch: QueuedMessage | null = null;

    for (const msg of queue) {
      // Only combine OUTPUT priority messages with content (not embeds)
      if (
        msg.priority === Priority.OUTPUT &&
        msg.payload.content &&
        !msg.payload.embeds?.length
      ) {
        if (currentBatch && currentBatch.payload.content) {
          // Combine content, respecting 2000 char limit
          const newContent =
            currentBatch.payload.content + '\n' + msg.payload.content;
          if (newContent.length <= 2000) {
            currentBatch.payload.content = newContent;
            continue;
          }
        }
        currentBatch = { ...msg, payload: { ...msg.payload } };
        combined.push(currentBatch);
      } else {
        currentBatch = null;
        combined.push(msg);
      }
    }

    // Replace queue contents
    queue.length = 0;
    queue.push(...combined);
  }

  /**
   * Process queued messages for a channel
   */
  private async processQueue(channelId: string): Promise<void> {
    if (this.processing.has(channelId)) return;
    this.processing.add(channelId);

    try {
      const queue = this.queues.get(channelId);
      if (!queue) return;

      while (queue.length > 0) {
        // Refill tokens if enough time has passed
        this.refillTokens(channelId);

        const tokens = this.tokens.get(channelId) || 0;
        if (tokens <= 0) {
          // Wait for token refill
          const waitTime = this.getWaitTime(channelId);
          await this.sleep(waitTime);
          continue;
        }

        // Take next message from queue
        const message = queue.shift();
        if (!message) break;

        // Consume a token
        this.tokens.set(channelId, tokens - 1);

        // Send the message
        try {
          await this.sendFn(message.channelId, message.payload);
          this.lastError = null;
        } catch (error) {
          this.lastError =
            error instanceof Error ? error.message : 'Unknown error';
          console.error(`Failed to send message to ${channelId}:`, error);

          // On rate limit error, wait and retry
          if (
            this.lastError.includes('rate limit') ||
            this.lastError.includes('429')
          ) {
            // Put message back at front of queue
            queue.unshift(message);
            // Force wait before retry
            this.tokens.set(channelId, 0);
            await this.sleep(this.refillInterval);
          }
        }
      }
    } finally {
      this.processing.delete(channelId);
    }
  }

  /**
   * Refill tokens based on time elapsed
   */
  private refillTokens(channelId: string): void {
    const now = Date.now();
    const lastRefill = this.lastRefill.get(channelId) || now;
    const elapsed = now - lastRefill;

    if (elapsed >= this.refillInterval) {
      const refills = Math.floor(elapsed / this.refillInterval);
      const currentTokens = this.tokens.get(channelId) || 0;
      const newTokens = Math.min(
        this.maxTokens,
        currentTokens + refills * this.refillAmount
      );

      this.tokens.set(channelId, newTokens);
      this.lastRefill.set(
        channelId,
        lastRefill + refills * this.refillInterval
      );
    }
  }

  /**
   * Get time to wait until next token is available
   */
  private getWaitTime(channelId: string): number {
    const lastRefill = this.lastRefill.get(channelId) || Date.now();
    const nextRefill = lastRefill + this.refillInterval;
    return Math.max(0, nextRefill - Date.now());
  }

  /**
   * Sleep for specified milliseconds
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get count of pending messages across all channels
   */
  getPendingCount(): number {
    let count = 0;
    for (const queue of this.queues.values()) {
      count += queue.length;
    }
    return count;
  }

  /**
   * Get channels that are currently rate-limited (no tokens)
   */
  getLimitedChannels(): string[] {
    const limited: string[] = [];
    for (const [channelId, tokens] of this.tokens) {
      if (tokens <= 0) {
        limited.push(channelId);
      }
    }
    return limited;
  }

  /**
   * Get the last error message
   */
  getLastError(): string | null {
    return this.lastError;
  }
}
