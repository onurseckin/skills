import type {
  CaptureBrowserDriver,
  CaptureBrowserProvider,
  CapturePageDriver,
} from "../runners/types.ts";

export type PoolState = "INITIALIZING" | "READY" | "DRAINING" | "CLOSED";

export type BrowserInstanceStatus = "IDLE" | "BUSY" | "UNHEALTHY" | "DISPOSED";

export type BrowserPoolEventType =
  | "instance_created"
  | "instance_destroyed"
  | "instance_acquired"
  | "instance_released"
  | "instance_evicted"
  | "pool_drained"
  | "pool_closed"
  | "error";

export interface BrowserPoolEvent {
  readonly type: BrowserPoolEventType;
  readonly instanceId?: string | undefined;
  readonly details?: string | undefined;
  readonly timestamp: number;
}

export interface BrowserPoolOptions {
  readonly minInstances?: number | undefined;
  readonly maxInstances?: number | undefined;
  readonly idleTimeoutMs?: number | undefined;
  readonly acquireTimeoutMs?: number | undefined;
  readonly maxUsesPerInstance?: number | undefined;
  readonly healthCheckIntervalMs?: number | undefined;
  readonly headless?: boolean | undefined;
  readonly provider: CaptureBrowserProvider;
  readonly onEvent?: ((event: BrowserPoolEvent) => void) | undefined;
}

export interface BrowserPoolStats {
  readonly state: PoolState;
  readonly totalInstances: number;
  readonly idleInstances: number;
  readonly busyInstances: number;
  readonly pendingAcquires: number;
  readonly totalCreated: number;
  readonly totalDestroyed: number;
  readonly totalAcquired: number;
  readonly totalEvicted: number;
}

export interface IPooledBrowserInstance {
  readonly id: string;
  readonly status: BrowserInstanceStatus;
  readonly createdAt: number;
  readonly lastActiveAt: number;
  readonly useCount: number;
  readonly driver: CaptureBrowserDriver;
  newPage(): Promise<CapturePageDriver>;
  isHealthy(): Promise<boolean>;
  close(): Promise<void>;
}

export interface IBrowserPool {
  acquire(): Promise<IPooledBrowserInstance>;
  release(instance: IPooledBrowserInstance): Promise<void>;
  evict(instance: IPooledBrowserInstance): Promise<void>;
  withBrowser<T>(fn: (instance: IPooledBrowserInstance) => Promise<T>): Promise<T>;
  getStats(): BrowserPoolStats;
  prewarm(): Promise<void>;
  drain(): Promise<void>;
  close(): Promise<void>;
}
