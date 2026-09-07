import {
  DEFAULT_RATE_LIMIT_THRESHOLD_RATIO,
  FLEET_PRIORITY_WEIGHTS,
  MAX_FLEET_CONCURRENCY_CAP,
} from "./constants.ts";
import type { FleetTaskPriority } from "./types.ts";

export function getPriorityWeight(priority: FleetTaskPriority): number {
  return FLEET_PRIORITY_WEIGHTS[priority] ?? 50;
}

export function computeFleetSaturationRatio(
  activeCount: number,
  maxCap: number = MAX_FLEET_CONCURRENCY_CAP,
): number {
  if (maxCap <= 0) return 1.0;
  return Math.min(1.0, Math.max(0.0, activeCount / maxCap));
}

export function isFleetSaturated(
  activeCount: number,
  maxCap: number = MAX_FLEET_CONCURRENCY_CAP,
): boolean {
  return activeCount >= maxCap;
}

export function isRateLimitRisk(
  activeCount: number,
  maxCap: number = MAX_FLEET_CONCURRENCY_CAP,
  thresholdRatio: number = DEFAULT_RATE_LIMIT_THRESHOLD_RATIO,
): boolean {
  return computeFleetSaturationRatio(activeCount, maxCap) >= thresholdRatio;
}
