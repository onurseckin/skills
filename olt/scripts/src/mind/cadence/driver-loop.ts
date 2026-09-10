import { classifyPulseExit, parsePulseLockMechanism } from "./pulse-outcome.ts";
import {
  DEFAULT_MAX_WAIT_SLICE_MS,
  DEFAULT_MIN_PULSE_INTERVAL_MS,
  decideNextPulse,
} from "./driver-schedule.ts";
import { applyPulseOutcome, buildLiveHealthRecord } from "./driver-health.ts";
import type {
  PulseDriverCounters,
  PulseDriverHealthRecord,
  PulseInvocationResult,
  PulseOutcome,
  PulseScheduleDecision,
} from "./types.ts";

export const CLOSING_FORBIDDEN_FOR_MIND = "CLOSING_FORBIDDEN_FOR_MIND" as const;

export interface PulseDriverPorts {
  readonly now: () => number;
  readonly readNextWakeAt: (runRoot: string) => string | null;
  readonly runPulse: (runRoot: string) => PulseInvocationResult;
  readonly writeHealth: (runRoot: string, record: PulseDriverHealthRecord) => void;
  readonly sleep: (ms: number) => void;
}

export interface PulseDriverConfig {
  readonly runRoot: string;
  readonly pid: number;
  readonly startedAtMs: number;
  readonly minIntervalMs?: number;
  readonly maxSliceMs?: number;
  readonly enforceInfiniteCadence?: boolean;
}

export interface PulseDriverStepResult {
  readonly counters: PulseDriverCounters;
  readonly decision: PulseScheduleDecision;
  readonly outcome: PulseOutcome | null;
  readonly nextWakeAt: string | null;
  readonly health: PulseDriverHealthRecord;
}

export function stepPulseDriver(
  config: PulseDriverConfig,
  counters: PulseDriverCounters,
  ports: PulseDriverPorts,
): PulseDriverStepResult {
  const nowMs = ports.now();
  const nextWakeAt = ports.readNextWakeAt(config.runRoot);
  const minIntervalMs =
    config.minIntervalMs !== undefined && config.minIntervalMs !== null
      ? config.minIntervalMs
      : DEFAULT_MIN_PULSE_INTERVAL_MS;
  const maxSliceMs =
    config.maxSliceMs !== undefined && config.maxSliceMs !== null
      ? config.maxSliceMs
      : DEFAULT_MAX_WAIT_SLICE_MS;

  const decision = decideNextPulse({
    nowMs,
    nextWakeAt,
    lastAttemptAtMs: counters.last_attempt_at_ms,
    minIntervalMs,
    maxSliceMs,
  });

  if (!decision.due) {
    const health = buildLiveHealthRecord({
      runRoot: config.runRoot,
      pid: config.pid,
      currentPid: config.pid,
      startedAtMs: config.startedAtMs,
      nowMs,
      nextWakeAt,
      counters,
    });
    ports.writeHealth(config.runRoot, health);
    ports.sleep(decision.waitMs);
    return { counters, decision, outcome: null, nextWakeAt, health };
  }

  const invocation = ports.runPulse(config.runRoot);
  const outcome = classifyPulseExit(invocation.exitCode);
  const parsedLockMech = parsePulseLockMechanism(invocation.stderr);
  const fallbackLockMech =
    parsedLockMech !== undefined && parsedLockMech !== null ? parsedLockMech : null;
  const mechanism =
    invocation.lockMechanism !== undefined && invocation.lockMechanism !== null
      ? invocation.lockMechanism
      : fallbackLockMech;
  const attemptAtMs = ports.now();
  const nextCounters = applyPulseOutcome(
    counters,
    outcome,
    invocation.exitCode,
    attemptAtMs,
    mechanism,
    invocation.stderr,
  );
  const observedWakeAt = ports.readNextWakeAt(config.runRoot);
  const health = buildLiveHealthRecord({
    runRoot: config.runRoot,
    pid: config.pid,
    currentPid: config.pid,
    startedAtMs: config.startedAtMs,
    nowMs: attemptAtMs,
    nextWakeAt: observedWakeAt,
    counters: nextCounters,
  });
  ports.writeHealth(config.runRoot, health);
  return {
    counters: nextCounters,
    decision,
    outcome,
    nextWakeAt: observedWakeAt,
    health,
  };
}

export interface PulseDriverRunResult {
  readonly counters: PulseDriverCounters;
  readonly iterations: number;
}

export function runPulseDriver(
  config: PulseDriverConfig,
  initial: PulseDriverCounters,
  ports: PulseDriverPorts,
  shouldContinue?: (iteration: number, counters: PulseDriverCounters) => boolean,
): PulseDriverRunResult {
  let counters = initial;
  let iterations = 0;
  // Under CLOSING_FORBIDDEN_FOR_MIND, default cadence is infinite; clear queues never terminate unprompted
  const continueFn = typeof shouldContinue === "function" ? shouldContinue : () => true;
  while (continueFn(iterations, counters)) {
    const step = stepPulseDriver(config, counters, ports);
    counters = step.counters;
    iterations += 1;
  }
  return { counters, iterations };
}
