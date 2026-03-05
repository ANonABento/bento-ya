/**
 * Persistent queue for Discord messages
 * Survives sidecar restarts by storing messages to disk
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { Priority, type MessagePayload } from './rate-limiter.js';

/**
 * Message stored in persistent queue
 */
export interface PersistedMessage {
  id: string;
  channelId: string;
  payload: MessagePayload;
  priority: Priority;
  createdAt: number;
  retryCount: number;
}

interface QueueData {
  version: number;
  messages: PersistedMessage[];
}

/**
 * Persistent queue backed by JSON file
 */
export class PersistentQueue {
  private readonly filePath: string;
  private messages: PersistedMessage[] = [];
  private dirty = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(dataDir: string) {
    this.filePath = join(dataDir, 'discord-queue.json');
    this.load();
  }

  /**
   * Load queue from disk
   */
  private load(): void {
    try {
      if (existsSync(this.filePath)) {
        const data = readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(data) as QueueData;
        if (parsed.version === 1 && Array.isArray(parsed.messages)) {
          this.messages = parsed.messages;
          console.log(`Loaded ${this.messages.length} messages from persistent queue`);
        }
      }
    } catch (error) {
      console.error('Failed to load persistent queue:', error);
      this.messages = [];
    }
  }

  /**
   * Save queue to disk (debounced)
   */
  private scheduleSave(): void {
    this.dirty = true;

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }

    this.flushTimer = setTimeout(() => {
      this.save();
    }, 1000); // Debounce 1 second
  }

  /**
   * Immediately save queue to disk
   */
  private save(): void {
    if (!this.dirty) return;

    try {
      const dir = dirname(this.filePath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      const data: QueueData = {
        version: 1,
        messages: this.messages,
      };

      writeFileSync(this.filePath, JSON.stringify(data, null, 2), 'utf-8');
      this.dirty = false;
    } catch (error) {
      console.error('Failed to save persistent queue:', error);
    }
  }

  /**
   * Add a message to the queue
   */
  push(channelId: string, payload: MessagePayload, priority: Priority): void {
    const message: PersistedMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      channelId,
      payload,
      priority,
      createdAt: Date.now(),
      retryCount: 0,
    };

    this.messages.push(message);
    this.messages.sort((a, b) => a.priority - b.priority);
    this.scheduleSave();
  }

  /**
   * Get and remove all messages from queue
   */
  drain(): PersistedMessage[] {
    const messages = [...this.messages];
    this.messages = [];
    this.scheduleSave();
    return messages;
  }

  /**
   * Get all messages without removing
   */
  peek(): PersistedMessage[] {
    return [...this.messages];
  }

  /**
   * Remove a specific message by ID
   */
  remove(id: string): boolean {
    const idx = this.messages.findIndex((m) => m.id === id);
    if (idx >= 0) {
      this.messages.splice(idx, 1);
      this.scheduleSave();
      return true;
    }
    return false;
  }

  /**
   * Increment retry count for a message
   */
  markRetry(id: string): void {
    const msg = this.messages.find((m) => m.id === id);
    if (msg) {
      msg.retryCount++;
      this.scheduleSave();
    }
  }

  /**
   * Get queue size
   */
  size(): number {
    return this.messages.length;
  }

  /**
   * Clear messages that have exceeded retry limit
   */
  clearFailed(maxRetries = 3): PersistedMessage[] {
    const failed = this.messages.filter((m) => m.retryCount >= maxRetries);
    this.messages = this.messages.filter((m) => m.retryCount < maxRetries);

    if (failed.length > 0) {
      this.scheduleSave();
    }

    return failed;
  }

  /**
   * Force save (call before shutdown)
   */
  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.save();
  }
}
