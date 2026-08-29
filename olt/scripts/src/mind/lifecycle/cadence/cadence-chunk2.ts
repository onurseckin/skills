import { HarnessError } from "../../../core/errors/index.ts";
import {
  DEFAULT_MAX_PAUSE_INTERVAL_MS,
  calculateExponentialBackoff,
  applyIntervalJitter,
} from "../../interval.ts";
import {
  DEFAULT_CADENCE_BASE_INTERVAL_MS,
  DEFAULT_CADENCE_MAX_INTERVAL_MS,
  ZERO_SLEEP_DELAY_MS,
  PERPETUAL_NON_STOPPING_CADENCE,
  CLOSING_FORBIDDEN_FOR_MIND,
} from "./cadence-chunk1.ts";
import type {
  CadenceEvent,
  CadenceEventListener,
  CadencePhase,
  CadenceState,
  CadenceTelemetry,
  CadenceTrigger,
  RolloverDecision,
  RolloverEvaluationOptions,
} from "./cadence-chunk1.ts";


/**
 * Evaluates whether an immediate rollover should occur per Anti-Idle specifications.
 * When active tasks, pending feedback, or positive pulse value exist, triggers 0ms immediate rollover.
 */
export function evaluateAntiIdleRollover(options: RolloverEvaluationOptions): RolloverDecision {
  const {
    trigger,
    pendingTasks = 0,
    pendingFeedback = 0,
    zeroValueStreak = 0,
    baseIntervalMs = DEFAULT_CADENCE_BASE_INTERVAL_MS,
    maxIntervalMs = DEFAULT_CADENCE_MAX_INTERVAL_MS,
    maxPauseIntervalMs = DEFAULT_MAX_PAUSE_INTERVAL_MS,
    previousIntervalMs,
    isHalted = false,
    isRateLimited = false,
    applyJitter = true,
    random = Math.random,
  } = options;

  if (isHalted || trigger.type === "SAFETY_HALT") {
    return {
      shouldRolloverImmediately: false,
      targetDelayMs: -1,
      targetPhase: "HALTED",
      reason: "Cadence halted: safety halt invariant or halted run state",
      trigger,
      zeroValueStreak,
      hasPendingWork: false,
      pendingTaskCount: pendingTasks,
      pendingFeedbackCount: pendingFeedback,
    };
  }

  const hasPendingWork = pendingTasks > 0 || pendingFeedback > 0;

  // Case 1: Work available or feedback received or explicit immediate rollover trigger
  if (
    hasPendingWork ||
    trigger.type === "WORK_AVAILABLE" ||
    trigger.type === "FEEDBACK_RECEIVED" ||
    trigger.type === "IMMEDIATE_ROLLOVER"
  ) {
    const workItems = pendingTasks + pendingFeedback;
    const desc =
      workItems > 0
        ? `${pendingTasks} task(s), ${pendingFeedback} feedback item(s)`
        : `event '${trigger.type}'`;
    return {
      shouldRolloverImmediately: true,
      targetDelayMs: ZERO_SLEEP_DELAY_MS,
      targetPhase: "ACTIVE",
      reason: `Anti-idle immediate rollover: active work present (${desc})`,
      trigger,
      zeroValueStreak: 0,
      hasPendingWork: true,
      pendingTaskCount: pendingTasks,
      pendingFeedbackCount: pendingFeedback,
    };
  }

  // Case 2: Pulse completed with positive value
  if (trigger.type === "PULSE_COMPLETED") {
    const pulseValue = typeof trigger.payload?.value === "number" ? trigger.payload.value : 0;
    if (pulseValue > 0) {
      return {
        shouldRolloverImmediately: true,
        targetDelayMs: ZERO_SLEEP_DELAY_MS,
        targetPhase: "ACTIVE",
        reason: `Anti-idle immediate rollover: previous pulse produced positive value (${pulseValue})`,
        trigger,
        zeroValueStreak: 0,
        hasPendingWork: false,
        pendingTaskCount: 0,
        pendingFeedbackCount: 0,
      };
    }
  }

  // Case 3: Rate limited backoff
  if (isRateLimited || trigger.type === "RATE_LIMIT_BACKOFF") {
    const prev =
      previousIntervalMs !== undefined && previousIntervalMs > 0
        ? previousIntervalMs
        : baseIntervalMs;
    const rawPause = Math.min(maxPauseIntervalMs, prev * 2);
    const delay = applyJitter
      ? applyIntervalJitter(rawPause, { random, maxIntervalMs: maxPauseIntervalMs })
      : rawPause;
    return {
      shouldRolloverImmediately: false,
      targetDelayMs: delay,
      targetPhase: "RESTING",
      reason: `Rate limit backoff: paused for ${delay}ms`,
      trigger,
      zeroValueStreak: zeroValueStreak + 1,
      hasPendingWork: false,
      pendingTaskCount: 0,
      pendingFeedbackCount: 0,
    };
  }

  // Case 4: Quiescent / idle state -> calculate exponential backoff with jitter
  const nextStreak = zeroValueStreak + 1;
  const rawBackoff = calculateExponentialBackoff(baseIntervalMs, maxIntervalMs, nextStreak);
  const targetDelayMs = applyJitter
    ? applyIntervalJitter(rawBackoff, { random, maxIntervalMs })
    : rawBackoff;

  return {
    shouldRolloverImmediately: false,
    targetDelayMs,
    targetPhase: "RESTING",
    reason: `Quiescent backoff: streak ${nextStreak}, next interval ${targetDelayMs}ms`,
    trigger,
    zeroValueStreak: nextStreak,
    hasPendingWork: false,
    pendingTaskCount: 0,
    pendingFeedbackCount: 0,
  };
}


/**
 * Enforces the infinite autonomous Mind cadence invariant.
 * Confirms closing is strictly forbidden and mind loops remain perpetually active.
 */
export function enforceInfiniteMindCadence(state: CadenceState): {
  readonly isPermitted: true;
  readonly closingForbidden: true;
  readonly invariant: typeof CLOSING_FORBIDDEN_FOR_MIND;
  readonly message: string;
} {
  return {
    isPermitted: true,
    closingForbidden: true,
    invariant: CLOSING_FORBIDDEN_FOR_MIND,
    message: `Perpetual Mind Cadence enforced: Generation ${state.generation}, pulse counter ${state.pulseCounter}. Mind loops never close or terminate when idle.`,
  };
}


/**
 * Creates initial baseline CadenceState.
 */
export function createInitialCadenceState(
  options: {
    readonly generation?: number | undefined;
    readonly baseIntervalMs?: number | undefined;
    readonly now?: string | number | Date | undefined;
  } = {},
): CadenceState {
  const generation = options.generation ?? 1;
  const baseIntervalMs = options.baseIntervalMs ?? DEFAULT_CADENCE_BASE_INTERVAL_MS;
  const nowMs = options.now !== undefined ? new Date(options.now).getTime() : Date.now();
  const nextWakeAt = new Date(nowMs + baseIntervalMs).toISOString();

  return {
    status: "RUNNING",
    currentPhase: "IDLE",
    generation,
    pulseCounter: 0,
    rolloverCounter: 0,
    immediateRolloverCounter: 0,
    zeroValueStreak: 0,
    lastPulseAt: null,
    lastRolloverAt: null,
    currentIntervalMs: baseIntervalMs,
    nextWakeAt,
    infiniteCadenceEnforced: true,
    closing_permitted: false,
    invariant: CLOSING_FORBIDDEN_FOR_MIND,
  };
}


/**
 * Event-Driven Cadence Trigger Dispatcher.
 * Handles subscribers and propagates trigger events asynchronously or synchronously.
 */
export class CadenceTriggerDispatcher {
  private readonly listeners: Set<CadenceEventListener> = new Set();

  public subscribe(listener: CadenceEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public unsubscribe(listener: CadenceEventListener): void {
    this.listeners.delete(listener);
  }

  public get listenerCount(): number {
    return this.listeners.size;
  }

  public async dispatch(event: CadenceEvent): Promise<void> {
    const promises: Promise<void>[] = [];
    for (const listener of this.listeners) {
      try {
        const res = listener(event);
        if (res instanceof Promise) {
          promises.push(res);
        }
      } catch {
        // Individual listener failures must not halt dispatcher
      }
    }
    if (promises.length > 0) {
      await Promise.allSettled(promises);
    }
  }

  public clear(): void {
    this.listeners.clear();
  }
}


export interface MindCadenceEngineOptions {
  readonly generation?: number | undefined;
  readonly baseIntervalMs?: number | undefined;
  readonly maxIntervalMs?: number | undefined;
  readonly maxPauseIntervalMs?: number | undefined;
  readonly applyJitter?: boolean | undefined;
  readonly random?: (() => number) | undefined;
}
