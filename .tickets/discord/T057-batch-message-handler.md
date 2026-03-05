# T057: Batch Message Handler

## Summary

Handle Discord rate limits gracefully with intelligent batching, queuing, and retry logic. Ensure messages aren't lost during high-volume agent output.

## Acceptance Criteria

- [ ] Rate limit aware: max 5 messages per 5 seconds per channel
- [ ] Automatic batching when approaching limits
- [ ] Retry with exponential backoff on 429 errors
- [ ] Message queue persisted (survive sidecar restart)
- [ ] Queue status visible in settings panel
- [ ] Graceful degradation: combine messages if backed up
- [ ] Priority system: completion messages > output > status

## Technical Design

### Rate Limiter

```typescript
// sidecars/discord-bot/src/rate-limiter.ts

interface RateLimitBucket {
  remaining: number;
  resetAt: number;
  queue: QueuedMessage[];
}

class RateLimiter {
  private buckets = new Map<string, RateLimitBucket>();
  private readonly LIMIT = 5;
  private readonly WINDOW_MS = 5000;

  async send(channelId: string, message: MessagePayload, priority: Priority): Promise<void> {
    const bucket = this.getBucket(channelId);

    if (bucket.remaining > 0 && Date.now() >= bucket.resetAt) {
      // Reset bucket
      bucket.remaining = this.LIMIT;
      bucket.resetAt = Date.now() + this.WINDOW_MS;
    }

    if (bucket.remaining > 0) {
      bucket.remaining--;
      await this.doSend(channelId, message);
    } else {
      // Queue with priority
      this.enqueue(bucket, message, priority);
      this.scheduleFlush(channelId, bucket.resetAt - Date.now());
    }
  }

  private enqueue(bucket: RateLimitBucket, message: MessagePayload, priority: Priority) {
    const qm: QueuedMessage = { message, priority, createdAt: Date.now() };

    // Insert by priority
    const idx = bucket.queue.findIndex(m => m.priority < priority);
    if (idx === -1) {
      bucket.queue.push(qm);
    } else {
      bucket.queue.splice(idx, 0, qm);
    }
  }

  private scheduleFlush(channelId: string, delayMs: number) {
    setTimeout(() => this.flushBucket(channelId), delayMs);
  }

  private async flushBucket(channelId: string) {
    const bucket = this.getBucket(channelId);
    bucket.remaining = this.LIMIT;
    bucket.resetAt = Date.now() + this.WINDOW_MS;

    // Batch queued messages if too many
    if (bucket.queue.length > this.LIMIT) {
      this.combineMessages(bucket);
    }

    while (bucket.queue.length > 0 && bucket.remaining > 0) {
      const qm = bucket.queue.shift()!;
      bucket.remaining--;

      try {
        await this.doSend(channelId, qm.message);
      } catch (error) {
        if (isRateLimitError(error)) {
          // Re-queue and wait
          bucket.queue.unshift(qm);
          const retryAfter = error.retryAfter || this.WINDOW_MS;
          this.scheduleFlush(channelId, retryAfter);
          return;
        }
        throw error;
      }
    }

    if (bucket.queue.length > 0) {
      this.scheduleFlush(channelId, this.WINDOW_MS);
    }
  }

  private combineMessages(bucket: RateLimitBucket) {
    // Combine low-priority output messages
    const outputs = bucket.queue.filter(m => m.priority === Priority.OUTPUT);
    if (outputs.length <= 2) return;

    // Remove individual outputs
    bucket.queue = bucket.queue.filter(m => m.priority !== Priority.OUTPUT);

    // Create combined message
    const combined = outputs.map(o => o.message.content).join('\n\n---\n\n');
    bucket.queue.push({
      message: { content: combined },
      priority: Priority.OUTPUT,
      createdAt: outputs[0].createdAt,
    });
  }
}

enum Priority {
  COMPLETION = 3, // Agent done, errors
  STATUS = 2,     // Task moved, thread updates
  OUTPUT = 1,     // Regular agent output
}
```

### Persistent Queue

```typescript
// sidecars/discord-bot/src/persistent-queue.ts

import { Low } from 'lowdb';
import { JSONFile } from 'lowdb/node';

interface QueueStore {
  messages: Array<{
    id: string;
    channelId: string;
    payload: MessagePayload;
    priority: Priority;
    createdAt: number;
    retries: number;
  }>;
}

class PersistentQueue {
  private db: Low<QueueStore>;

  async init() {
    const adapter = new JSONFile<QueueStore>('discord-queue.json');
    this.db = new Low(adapter, { messages: [] });
    await this.db.read();

    // Process any messages from previous session
    this.processStored();
  }

  async enqueue(channelId: string, payload: MessagePayload, priority: Priority) {
    this.db.data!.messages.push({
      id: crypto.randomUUID(),
      channelId,
      payload,
      priority,
      createdAt: Date.now(),
      retries: 0,
    });
    await this.db.write();
  }

  async dequeue(id: string) {
    const idx = this.db.data!.messages.findIndex(m => m.id === id);
    if (idx !== -1) {
      this.db.data!.messages.splice(idx, 1);
      await this.db.write();
    }
  }

  async markFailed(id: string) {
    const msg = this.db.data!.messages.find(m => m.id === id);
    if (msg) {
      msg.retries++;
      if (msg.retries >= 3) {
        // Move to dead letter
        console.error('Message failed after 3 retries:', msg);
        await this.dequeue(id);
      } else {
        await this.db.write();
      }
    }
  }

  private async processStored() {
    for (const msg of this.db.data!.messages) {
      await rateLimiter.send(msg.channelId, msg.payload, msg.priority);
      await this.dequeue(msg.id);
    }
  }
}
```

### Queue Status API

```typescript
// sidecars/discord-bot/src/commands/status.ts

interface QueueStatus {
  connected: boolean;
  pendingMessages: number;
  rateLimitedChannels: string[];
  lastError: string | null;
}

function getQueueStatus(): QueueStatus {
  return {
    connected: client.isReady(),
    pendingMessages: persistentQueue.count(),
    rateLimitedChannels: rateLimiter.getLimitedChannels(),
    lastError: errorTracker.getLastError(),
  };
}
```

### Frontend Status Display

```tsx
// src/components/settings/discord-section.tsx

function QueueStatus({ status }: { status: QueueStatus }) {
  if (status.pendingMessages === 0) return null;

  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-3 w-3 animate-spin" />
      <span>{status.pendingMessages} messages queued</span>
      {status.rateLimitedChannels.length > 0 && (
        <span className="text-yellow-500">
          (rate limited: {status.rateLimitedChannels.length} channels)
        </span>
      )}
    </div>
  );
}
```

## Implementation Steps

1. Create RateLimiter class with bucket tracking
2. Implement priority-based queuing
3. Add message combining for backed-up queues
4. Create PersistentQueue with lowdb
5. Wire up retry logic with exponential backoff
6. Add queue status command to sidecar
7. Create status display in settings panel
8. Test under high load (rapid agent output)
9. Test sidecar restart recovery
10. Add metrics logging

## Files

**New:**
- `sidecars/discord-bot/src/rate-limiter.ts`
- `sidecars/discord-bot/src/persistent-queue.ts`
- `sidecars/discord-bot/src/commands/status.ts`

**Modified:**
- `sidecars/discord-bot/src/handlers/agent-output.ts` - Use rate limiter
- `src/components/settings/discord-section.tsx` - Add queue status

## Dependencies

- T056 (Agent Output Streaming) - Output handlers

## Complexity

**S** - Standard rate limiting patterns

## Commit

`feat(discord): add rate-limiting and persistent message queue`
