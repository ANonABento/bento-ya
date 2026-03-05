/**
 * Output buffer for debouncing agent output to Discord
 * Accumulates output deltas and flushes after a delay to reduce message spam
 */

export interface BufferedOutput {
  taskId: string;
  content: string;
  lastUpdate: number;
  timeout: ReturnType<typeof setTimeout> | null;
}

export type FlushCallback = (taskId: string, content: string) => Promise<void>;

export class OutputBuffer {
  private buffers = new Map<string, BufferedOutput>();
  private readonly debounceMs: number;
  private readonly maxBuffer: number;
  private onFlush: FlushCallback;

  constructor(
    onFlush: FlushCallback,
    options: { debounceMs?: number; maxBuffer?: number } = {}
  ) {
    this.onFlush = onFlush;
    this.debounceMs = options.debounceMs ?? 500;
    this.maxBuffer = options.maxBuffer ?? 4000;
  }

  /**
   * Append output delta to the buffer
   */
  append(taskId: string, delta: string): void {
    let buffer = this.buffers.get(taskId);

    if (!buffer) {
      buffer = {
        taskId,
        content: '',
        lastUpdate: Date.now(),
        timeout: null,
      };
      this.buffers.set(taskId, buffer);
    }

    buffer.content += delta;
    buffer.lastUpdate = Date.now();

    // Clear existing timeout
    if (buffer.timeout) {
      clearTimeout(buffer.timeout);
      buffer.timeout = null;
    }

    // Force flush if buffer too large
    if (buffer.content.length >= this.maxBuffer) {
      void this.flush(taskId);
      return;
    }

    // Set new timeout for debounced flush
    buffer.timeout = setTimeout(() => {
      void this.flush(taskId);
    }, this.debounceMs);
  }

  /**
   * Flush the buffer for a task
   */
  async flush(taskId: string): Promise<void> {
    const buffer = this.buffers.get(taskId);
    if (!buffer || buffer.content.length === 0) return;

    // Clear timeout if pending
    if (buffer.timeout) {
      clearTimeout(buffer.timeout);
      buffer.timeout = null;
    }

    const content = buffer.content;
    buffer.content = '';

    try {
      await this.onFlush(taskId, content);
    } catch (error) {
      console.error(`Failed to flush output for task ${taskId}:`, error);
    }
  }

  /**
   * Force flush all output for a task (called on agent completion)
   */
  async flushAll(taskId: string): Promise<void> {
    const buffer = this.buffers.get(taskId);
    if (buffer?.timeout) {
      clearTimeout(buffer.timeout);
      buffer.timeout = null;
    }
    await this.flush(taskId);
    this.buffers.delete(taskId);
  }

  /**
   * Clear buffer without flushing (on task delete)
   */
  clear(taskId: string): void {
    const buffer = this.buffers.get(taskId);
    if (buffer?.timeout) {
      clearTimeout(buffer.timeout);
    }
    this.buffers.delete(taskId);
  }
}
