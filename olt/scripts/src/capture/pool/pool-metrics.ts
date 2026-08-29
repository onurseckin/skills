import type { PooledBrowserInstance } from "./browser-instance.ts";
import type { BrowserPoolEvent, BrowserPoolOptions, BrowserPoolStats, PoolState } from "./types.ts";

export interface PoolMetricsInput {
  readonly state: PoolState;
  readonly instances: ReadonlyMap<string, PooledBrowserInstance>;
  readonly idleCount: number;
  readonly pendingCount: number;
  readonly totalCreated: number;
  readonly totalDestroyed: number;
  readonly totalAcquired: number;
  readonly totalEvicted: number;
}

export function computePoolStats(input: PoolMetricsInput): BrowserPoolStats {
  let busyCount = 0;
  for (const inst of input.instances.values()) {
    if (inst.status === "BUSY") {
      busyCount += 1;
    }
  }
  return {
    state: input.state,
    totalInstances: input.instances.size,
    idleInstances: input.idleCount,
    busyInstances: busyCount,
    pendingAcquires: input.pendingCount,
    totalCreated: input.totalCreated,
    totalDestroyed: input.totalDestroyed,
    totalAcquired: input.totalAcquired,
    totalEvicted: input.totalEvicted,
  };
}

export function dispatchPoolEvent(
  options: BrowserPoolOptions,
  event: BrowserPoolEvent,
): void {
  if (options.onEvent) {
    try {
      options.onEvent(event);
    } catch {
    }
  }
}
