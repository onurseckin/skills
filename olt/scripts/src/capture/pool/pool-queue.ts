import type { PooledBrowserInstance } from "./browser-instance.ts";
import type { IPooledBrowserInstance } from "./types.ts";

export interface PendingAcquire {
  readonly resolve: (instance: IPooledBrowserInstance) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export class AcquireQueue {
  private readonly _queue: PendingAcquire[] = [];

  get length(): number {
    return this._queue.length;
  }

  enqueue(acquire: PendingAcquire): void {
    this._queue.push(acquire);
  }

  dequeue(): PendingAcquire | undefined {
    return this._queue.shift();
  }

  removeByTimer(timer: ReturnType<typeof setTimeout>): boolean {
    const idx = this._queue.findIndex((p) => p.timer === timer);
    if (idx >= 0) {
      this._queue.splice(idx, 1);
      return true;
    }
    return false;
  }

  clearAndRejectAll(error: Error): void {
    while (this._queue.length > 0) {
      const item = this._queue.shift();
      if (item) {
        clearTimeout(item.timer);
        item.reject(error);
      }
    }
  }
}

export function isInstanceExpired(
  instance: PooledBrowserInstance,
  options: {
    readonly maxUsesPerInstance: number;
    readonly idleTimeoutMs: number;
  },
): boolean {
  if (instance.status === "UNHEALTHY" || instance.status === "DISPOSED") {
    return true;
  }
  if (instance.useCount >= options.maxUsesPerInstance) {
    return true;
  }
  if (options.idleTimeoutMs > 0 && Date.now() - instance.lastActiveAt > options.idleTimeoutMs) {
    return true;
  }
  return false;
}
