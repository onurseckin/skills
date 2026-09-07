import type { FleetTaskPriority } from "./types.ts";

export const MAX_FLEET_CONCURRENCY_CAP = 50;
export const DEFAULT_LEASE_DURATION_MS = 300_000;
export const DEFAULT_RATE_LIMIT_THRESHOLD_RATIO = 0.9;
export const DEFAULT_MAX_QUEUE_SIZE = 1000;

export const FLEET_PRIORITY_WEIGHTS: Readonly<Record<FleetTaskPriority, number>> = {
  CRITICAL: 100,
  HIGH: 75,
  MEDIUM: 50,
  LOW: 25,
  BACKGROUND: 10,
};
