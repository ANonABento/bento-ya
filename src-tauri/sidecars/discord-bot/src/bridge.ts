/**
 * IPC Bridge for Rust <-> Node.js communication
 * Uses JSON over stdin/stdout
 */

import * as readline from 'readline';
import type { BridgeCommand, BridgeResponse, BridgeEvent } from './types.js';

type CommandHandler = (payload: unknown) => Promise<unknown>;

export class Bridge {
  private handlers = new Map<string, CommandHandler>();
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

    let command: BridgeCommand;
    try {
      command = JSON.parse(line) as BridgeCommand;
    } catch {
      this.emit('error', { message: 'Invalid JSON received', line });
      return;
    }

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

    try {
      const data = await handler(command.payload);
      const response: BridgeResponse = {
        id: command.id,
        success: true,
        data,
      };
      this.writeLine(response);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const response: BridgeResponse = {
        id: command.id,
        success: false,
        error: message,
      };
      this.writeLine(response);
    }
  }

  /**
   * Graceful shutdown
   */
  shutdown(): void {
    this.rl.close();
  }
}
