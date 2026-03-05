/**
 * IPC Bridge for Rust <-> Node.js communication
 * Uses JSON over stdin/stdout
 */

import * as readline from 'readline';
import type { BridgeCommand, BridgeResponse, BridgeEvent } from './types.js';

type CommandHandler = (payload: unknown) => Promise<unknown>;
type ResponseResolver = (response: BridgeResponse) => void;

export class Bridge {
  private handlers = new Map<string, CommandHandler>();
  private eventListeners = new Map<string, Set<(payload: unknown) => void>>();
  private pendingRequests = new Map<string, ResponseResolver>();
  private requestCounter = 0;
  private rl: readline.Interface;

  constructor() {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      terminal: false,
    });

    this.rl.on('line', (line) => this.handleLine(line));
    this.rl.on('close', () => {
      this.emit('disconnected', { reason: 'stdin closed' });
      process.exit(0);
    });

    // Handle uncaught errors
    process.on('uncaughtException', (err) => {
      this.emit('error', { message: err.message, stack: err.stack });
    });

    process.on('unhandledRejection', (err) => {
      const message = err instanceof Error ? err.message : String(err);
      this.emit('error', { message, type: 'unhandledRejection' });
    });
  }

  /**
   * Register a handler for a command type
   */
  on(type: string, handler: CommandHandler): void {
    this.handlers.set(type, handler);
  }

  /**
   * Emit an event to Rust (no response expected)
   */
  emit(event: string, payload: unknown): void {
    const msg: BridgeEvent = { event: event as BridgeEvent['event'], payload };
    this.writeLine(msg);
  }

  /**
   * Write a JSON line to stdout
   */
  private writeLine(data: unknown): void {
    const json = JSON.stringify(data);
    process.stdout.write(json + '\n');
  }

  /**
   * Handle an incoming line from stdin
   */
  private async handleLine(line: string): Promise<void> {
    if (!line.trim()) return;

    // Try to parse as a response first (for pending requests)
    try {
      const data = JSON.parse(line);

      // Check if it's a response to a pending request
      if ('id' in data && 'success' in data) {
        const resolver = this.pendingRequests.get(data.id);
        if (resolver) {
          this.pendingRequests.delete(data.id);
          resolver(data as BridgeResponse);
          return;
        }
      }

      // Check if it's an event
      if ('event' in data && 'payload' in data) {
        this.notifyEventListeners(data.event, data.payload);
        return;
      }

      // Otherwise treat as command
      const command = data as BridgeCommand;
      const handler = this.handlers.get(command.type);
      if (!handler) {
        const response: BridgeResponse = {
          id: command.id,
          success: false,
          error: `Unknown command type: ${command.type}`,
        };
        this.writeLine(response);
        return;
      }

      const result = await handler(command.payload);
      const response: BridgeResponse = {
        id: command.id,
        success: true,
        data: result,
      };
      this.writeLine(response);
    } catch (err) {
      this.emit('error', { message: 'Failed to process line', line, error: String(err) });
    }
  }

  /**
   * Send a request to Rust and wait for response
   */
  async send(request: { type: string; payload: unknown }): Promise<unknown> {
    this.requestCounter++;
    const id = `node-${this.requestCounter}`;

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`Request ${request.type} timed out`));
      }, 30000);

      this.pendingRequests.set(id, (response) => {
        clearTimeout(timeout);
        if (response.success) {
          resolve(response.data);
        } else {
          reject(new Error(response.error || 'Request failed'));
        }
      });

      const command: BridgeCommand = {
        id,
        type: request.type as BridgeCommand['type'],
        payload: request.payload,
      };
      this.writeLine(command);
    });
  }

  /**
   * Register an event listener
   */
  onEvent(event: string, listener: (payload: unknown) => void): void {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event)!.add(listener);
  }

  /**
   * Remove an event listener
   */
  offEvent(event: string, listener: (payload: unknown) => void): void {
    this.eventListeners.get(event)?.delete(listener);
  }

  /**
   * Notify event listeners
   */
  private notifyEventListeners(event: string, payload: unknown): void {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(payload);
        } catch (err) {
          console.error(`Event listener error for ${event}:`, err);
        }
      }
    }
  }

  /**
   * Graceful shutdown
   */
  shutdown(): void {
    this.rl.close();
  }
}
