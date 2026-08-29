import type { WatchdogStatus } from "./types.ts";

export const DEFAULT_HEARTBEAT_CADENCE_MS = 180_000; // 3 minutes standard cadence
export const DEFAULT_WATCHDOG_TIMEOUT_MS = 360_000; // 6 minutes timeout (2x cadence)

export const WATCHDOG_STATUSES = new Set<WatchdogStatus>([
  "active",
  "stale",
  "terminated",
  "orphaned",
]);
