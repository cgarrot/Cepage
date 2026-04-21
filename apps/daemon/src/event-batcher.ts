import type { DaemonMessage } from '@cepage/shared-core';

export type EventBatcherOptions = {
  flushIntervalMs: number;
  maxBatchSize: number;
  flush: (messages: DaemonMessage[]) => Promise<void>;
  onError?: (error: unknown) => void;
};

/**
 * Accumulates DaemonMessage events and flushes them in batches. Flushing
 * happens either when `flushIntervalMs` elapses since the previous flush, or
 * when `maxBatchSize` is reached, whichever comes first.
 */
export class EventBatcher {
  private buffer: DaemonMessage[] = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> | null = null;
  private closed = false;

  constructor(private readonly options: EventBatcherOptions) {}

  push(message: DaemonMessage): void {
    if (this.closed) return;
    this.buffer.push(message);
    if (this.buffer.length >= this.options.maxBatchSize) {
      void this.flushNow();
      return;
    }
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flushNow();
    }, this.options.flushIntervalMs);
  }

  async flushNow(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.buffer.length === 0) return;
    if (this.flushing) {
      await this.flushing;
      return;
    }
    const pending = this.buffer;
    this.buffer = [];
    this.flushing = this.options
      .flush(pending)
      .catch((error) => {
        this.options.onError?.(error);
      })
      .finally(() => {
        this.flushing = null;
      });
    await this.flushing;
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.flushNow();
  }
}
