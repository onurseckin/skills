import { PooledBrowserInstance } from "./browser-instance.ts";
import { closeAllInstances, createPoolInstance, drainIdleInstances } from "./pool-lifecycle.ts";
import { computePoolStats, dispatchPoolEvent } from "./pool-metrics.ts";
import { AcquireQueue, isInstanceExpired } from "./pool-queue.ts";
import type {
  BrowserPoolOptions,
  BrowserPoolStats,
  IBrowserPool,
  IPooledBrowserInstance,
  PoolState,
} from "./types.ts";

export class BrowserPoolManager implements IBrowserPool {
  private readonly _minInstances: number;
  private readonly _maxInstances: number;
  private readonly _idleTimeoutMs: number;
  private readonly _acquireTimeoutMs: number;
  private readonly _maxUsesPerInstance: number;
  private readonly _headless: boolean;
  private readonly _options: BrowserPoolOptions;
  private _state: PoolState = "INITIALIZING";

  private readonly _instances = new Map<string, PooledBrowserInstance>();
  private readonly _idleInstances: PooledBrowserInstance[] = [];
  private readonly _pendingQueue = new AcquireQueue();

  private _totalCreated = 0;
  private _totalDestroyed = 0;
  private _totalAcquired = 0;
  private _totalEvicted = 0;
  private _cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: BrowserPoolOptions) {
    this._options = options;
    this._minInstances = Math.max(0, options.minInstances ?? 0);
    this._maxInstances = Math.max(1, options.maxInstances ?? 4);
    this._idleTimeoutMs = options.idleTimeoutMs ?? 30_000;
    this._acquireTimeoutMs = options.acquireTimeoutMs ?? 10_000;
    this._maxUsesPerInstance = options.maxUsesPerInstance ?? 50;
    this._headless = options.headless !== false;

    this._state = "READY";

    const healthInterval = options.healthCheckIntervalMs ?? 0;
    if (healthInterval > 0 || this._idleTimeoutMs > 0) {
      const interval = Math.min(
        this._idleTimeoutMs > 0 ? this._idleTimeoutMs : 10_000,
        healthInterval > 0 ? healthInterval : 10_000,
      );
      this._cleanupTimer = setInterval(() => {
        void this.performHousekeeping();
      }, interval);
    }
  }

  get state(): PoolState {
    return this._state;
  }

  getStats(): BrowserPoolStats {
    return computePoolStats({
      state: this._state,
      instances: this._instances,
      idleCount: this._idleInstances.length,
      pendingCount: this._pendingQueue.length,
      totalCreated: this._totalCreated,
      totalDestroyed: this._totalDestroyed,
      totalAcquired: this._totalAcquired,
      totalEvicted: this._totalEvicted,
    });
  }

  async prewarm(): Promise<void> {
    if (this._state !== "READY") {
      throw new Error(`Cannot prewarm pool in ${this._state} state`);
    }
    while (this._instances.size < this._minInstances) {
      await this.createNewInstance();
    }
  }

  async acquire(): Promise<IPooledBrowserInstance> {
    if (this._state !== "READY") {
      throw new Error(`Cannot acquire browser instance from pool in ${this._state} state`);
    }

    while (this._idleInstances.length > 0) {
      const candidate = this._idleInstances.shift();
      if (!candidate || candidate.status === "DISPOSED") {
        continue;
      }
      if (this.checkExpired(candidate)) {
        await this.evict(candidate);
        continue;
      }
      candidate.markBusy();
      this._totalAcquired += 1;
      dispatchPoolEvent(this._options, {
        type: "instance_acquired",
        instanceId: candidate.id,
        timestamp: Date.now(),
      });
      return candidate;
    }

    if (this._instances.size < this._maxInstances) {
      const instance = await this.createNewInstance();
      const pooled = this._instances.get(instance.id);
      if (pooled) {
        const idleIdx = this._idleInstances.indexOf(pooled);
        if (idleIdx >= 0) {
          this._idleInstances.splice(idleIdx, 1);
        }
        pooled.markBusy();
        this._totalAcquired += 1;
        dispatchPoolEvent(this._options, {
          type: "instance_acquired",
          instanceId: pooled.id,
          timestamp: Date.now(),
        });
        return pooled;
      }
    }

    return new Promise<IPooledBrowserInstance>((resolve, reject) => {
      const timer = setTimeout(() => {
        this._pendingQueue.removeByTimer(timer);
        reject(
          new Error(
            `Browser acquisition timed out after ${this._acquireTimeoutMs}ms (pool capacity: ${this._instances.size}/${this._maxInstances})`,
          ),
        );
      }, this._acquireTimeoutMs);

      this._pendingQueue.enqueue({ resolve, reject, timer });
    });
  }

  async release(instance: IPooledBrowserInstance): Promise<void> {
    const pooled = this._instances.get(instance.id);
    if (!pooled || pooled.status === "DISPOSED") {
      return;
    }

    if (this.checkExpired(pooled) || this._state === "DRAINING" || this._state === "CLOSED") {
      await this.evict(pooled);
      return;
    }

    const pending = this._pendingQueue.dequeue();
    if (pending) {
      clearTimeout(pending.timer);
      pooled.markBusy();
      this._totalAcquired += 1;
      dispatchPoolEvent(this._options, {
        type: "instance_acquired",
        instanceId: pooled.id,
        timestamp: Date.now(),
      });
      pending.resolve(pooled);
      return;
    }

    pooled.markIdle();
    this._idleInstances.push(pooled);
    dispatchPoolEvent(this._options, {
      type: "instance_released",
      instanceId: pooled.id,
      timestamp: Date.now(),
    });
  }

  async evict(instance: IPooledBrowserInstance): Promise<void> {
    const pooled = this._instances.get(instance.id);
    if (!pooled) {
      return;
    }

    this._instances.delete(pooled.id);
    const idleIdx = this._idleInstances.indexOf(pooled);
    if (idleIdx >= 0) {
      this._idleInstances.splice(idleIdx, 1);
    }

    this._totalDestroyed += 1;
    this._totalEvicted += 1;
    await pooled.close();

    dispatchPoolEvent(this._options, {
      type: "instance_evicted",
      instanceId: pooled.id,
      timestamp: Date.now(),
    });

    if (this._state === "READY" && this._instances.size < this._minInstances) {
      void this.createNewInstance().catch(() => {});
    }
  }

  async withBrowser<T>(fn: (instance: IPooledBrowserInstance) => Promise<T>): Promise<T> {
    const instance = await this.acquire();
    try {
      return await fn(instance);
    } finally {
      await this.release(instance);
    }
  }

  async drain(): Promise<void> {
    this._state = "DRAINING";
    this._totalDestroyed += await drainIdleInstances(this._instances, this._idleInstances);
    if (this._instances.size === 0) {
      this._state = "CLOSED";
      dispatchPoolEvent(this._options, { type: "pool_drained", timestamp: Date.now() });
    }
  }

  async close(): Promise<void> {
    this._state = "CLOSED";
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
    this._totalDestroyed += await closeAllInstances(
      this._instances,
      this._idleInstances,
      this._pendingQueue,
    );
    dispatchPoolEvent(this._options, { type: "pool_closed", timestamp: Date.now() });
  }

  private async createNewInstance(): Promise<PooledBrowserInstance> {
    try {
      const instance = await createPoolInstance(this._options.provider, this._headless);
      this._instances.set(instance.id, instance);
      this._idleInstances.push(instance);
      this._totalCreated += 1;
      dispatchPoolEvent(this._options, {
        type: "instance_created",
        instanceId: instance.id,
        timestamp: Date.now(),
      });
      return instance;
    } catch (err) {
      dispatchPoolEvent(this._options, {
        type: "error",
        details: err instanceof Error ? err.message : String(err),
        timestamp: Date.now(),
      });
      throw err;
    }
  }

  private checkExpired(instance: PooledBrowserInstance): boolean {
    return isInstanceExpired(instance, {
      maxUsesPerInstance: this._maxUsesPerInstance,
      idleTimeoutMs: this._idleTimeoutMs,
    });
  }

  private async performHousekeeping(): Promise<void> {
    if (this._state !== "READY") {
      return;
    }
    const idleList = [...this._idleInstances];
    for (const inst of idleList) {
      if (this.checkExpired(inst)) {
        await this.evict(inst);
      }
    }
  }
}
