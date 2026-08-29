import {
  ERROR_CLASS_IDLE_TIMEOUT,
  ERROR_CLASS_STALL_TIMEOUT,
  ERROR_CLASS_WALL_TIMEOUT,
} from "./constants.ts";
import type { WatchdogLivenessReport } from "./types.ts";

export function evaluateProcessLiveness(params: {
  startedAtMs: number;
  lastActivityAtMs: number;
  lastProgressAtMs: number;
  wallTimeoutMs: number;
  idleTimeoutMs: number;
  stallProgressThresholdMs: number;
  nowMs: number;
}): WatchdogLivenessReport {
  const duration = params.nowMs - params.startedAtMs;
  const idleDuration = params.nowMs - params.lastActivityAtMs;
  const stallDuration = params.nowMs - params.lastProgressAtMs;

  if (duration >= params.wallTimeoutMs) {
    return {
      alive: false,
      timedOut: true,
      stalled: true,
      timeoutKind: "wall",
      errorClassification: ERROR_CLASS_WALL_TIMEOUT,
      reason: `Process wall timeout exceeded: execution duration ${duration}ms >= ${params.wallTimeoutMs}ms limit`,
    };
  }

  if (idleDuration >= params.idleTimeoutMs) {
    return {
      alive: false,
      timedOut: true,
      stalled: true,
      timeoutKind: "idle",
      errorClassification: ERROR_CLASS_IDLE_TIMEOUT,
      reason: `Process idle timeout exceeded: no activity for ${idleDuration}ms >= ${params.idleTimeoutMs}ms limit`,
    };
  }

  if (stallDuration >= params.stallProgressThresholdMs) {
    return {
      alive: false,
      timedOut: true,
      stalled: true,
      timeoutKind: "stall",
      errorClassification: ERROR_CLASS_STALL_TIMEOUT,
      reason: `Process stall detected: 0 progress recorded for ${stallDuration}ms >= ${params.stallProgressThresholdMs}ms threshold`,
    };
  }

  return {
    alive: true,
    timedOut: false,
    stalled: false,
    timeoutKind: null,
  };
}
