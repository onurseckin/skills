/**
 * Perpetual Autonomic Mind Cadence & Anti-Idle Immediate Rollover Engine.
 *
 * Implements the infinite autonomous cadence invariants:
 * - PERPETUAL_NON_STOPPING_CADENCE: Mind loops never terminate when idle.
 * - CLOSING_FORBIDDEN_FOR_MIND: Mind runs cannot self-close or terminate.
 * - Anti-Idle Immediate Rollover: Active work / pending tasks / feedback trigger 0ms instant rollover.
 * - Zero artificial sleep loops: transitions between phases are strictly non-blocking.
 * - Deterministic trigger dispatching and dynamic backoff coordination.
 */

import { HarnessError } from "../errors/harness-error.ts";
import {
  applyIntervalJitter,
  calculateExponentialBackoff,
  DEFAULT_BASE_INTERVAL_MS,
  DEFAULT_MAX_INTERVAL_MS,
  DEFAULT_MAX_PAUSE_INTERVAL_MS,
  type JitterOptions,
} from "./interval.ts";

export const PERPETUAL_NON_STOPPING_CADENCE = "infinite_autonomous" as const;
export const CLOSING_FORBIDDEN_FOR_MIND = "CLOSING_FORBIDDEN_FOR_MIND" as const;
export const ZERO_SLEEP_DELAY_MS = 0 as const;
export const DEFAULT_CADENCE_BASE_INTERVAL_MS = 900_000; // 15 minutes
export const DEFAULT_CADENCE_MAX_INTERVAL_MS = 14_400_000; // 4 hours
export const DEFAULT_CADENCE_GRACE_MS = 300_000; // 5 minutes

export type CadencePhase =
  | "IDLE"
  | "POLLING"
  | "ACTIVE"
  | "SYNTHESIZING"
  | "EXECUTING"
  | "ROLLOVER"
  | "RESTING"
  | "HALTED";

export type CadenceTriggerType =
  | "WORK_AVAILABLE"
  | "FEEDBACK_RECEIVED"
  | "PULSE_COMPLETED"
  | "IMMEDIATE_ROLLOVER"
  | "TIMER_EXPIRED"
  | "MANUAL_DISPATCH"
  | "STALE_PULSE_DETECTED"
  | "RATE_LIMIT_BACKOFF"
  | "SAFETY_HALT";

export type TriggerPriority = "CRITICAL" | "HIGH" | "NORMAL" | "LOW";

export interface CadenceTrigger {
  readonly type: CadenceTriggerType;
  readonly source: string;
  readonly timestamp: string;
  readonly payload?: Readonly<Record<string, unknown>> | undefined;
  readonly priority?: TriggerPriority | undefined;
}

export interface RolloverDecision {
  readonly shouldRolloverImmediately: boolean;
  readonly targetDelayMs: number; // 0 for immediate rollover, > 0 for resting, -1 if halted
  readonly targetPhase: CadencePhase;
  readonly reason: string;
  readonly trigger: CadenceTrigger;
  readonly zeroValueStreak: number;
  readonly hasPendingWork: boolean;
  readonly pendingTaskCount: number;
  readonly pendingFeedbackCount: number;
}

export interface CadenceState {
  readonly status: "RUNNING" | "PAUSED" | "HALTED";
  readonly currentPhase: CadencePhase;
  readonly generation: number;
  readonly pulseCounter: number;
  readonly rolloverCounter: number;
  readonly immediateRolloverCounter: number;
  readonly zeroValueStreak: number;
  readonly lastPulseAt: string | null;
  readonly lastRolloverAt: string | null;
  readonly currentIntervalMs: number;
  readonly nextWakeAt: string;
  readonly infiniteCadenceEnforced: true;
  readonly closing_permitted: false;
  readonly invariant: typeof CLOSING_FORBIDDEN_FOR_MIND;
}

export interface CadenceTelemetry {
  readonly totalPulses: number;
  readonly totalRollovers: number;
  readonly totalImmediateRollovers: number;
  readonly immediateRolloverRatio: number;
  readonly totalZeroSleepTransitions: number;
  readonly averagePulseDurationMs: number;
  readonly quiescenceStreak: number;
  readonly lastTriggerType: CadenceTriggerType | null;
  readonly isAntiIdleActive: boolean;
}

export interface CadenceEvent {
  readonly type: "PHASE_CHANGE" | "TRIGGER_DISPATCHED" | "ROLLOVER_EXECUTED" | "PULSE_TICK" | "STATE_TRANSITION";
  readonly previousPhase?: CadencePhase | undefined;
  readonly currentPhase: CadencePhase;
  readonly trigger?: CadenceTrigger | undefined;
  readonly decision?: RolloverDecision | undefined;
  readonly state: CadenceState;
  readonly timestamp: string;
}

export type CadenceEventListener = (event: CadenceEvent) => void | Promise<void>;

export interface RolloverEvaluationOptions {
  readonly trigger: CadenceTrigger;
  readonly pendingTasks?: number | undefined;
  readonly pendingFeedback?: number | undefined;
  readonly zeroValueStreak?: number | undefined;
  readonly baseIntervalMs?: number | undefined;
  readonly maxIntervalMs?: number | undefined;
  readonly maxPauseIntervalMs?: number | undefined;
  readonly previousIntervalMs?: number | undefined;
  readonly isHalted?: boolean | undefined;
  readonly isRateLimited?: boolean | undefined;
  readonly applyJitter?: boolean | undefined;
  readonly random?: (() => number) | undefined;
  readonly now?: string | number | Date | undefined;
}

export interface CadenceStepInput {
  readonly trigger?: CadenceTrigger | undefined;
  readonly pendingTasks?: number | undefined;
  readonly pendingFeedback?: number | undefined;
  readonly pulseOutcome?: string | undefined;
  readonly pulseValue?: number | undefined;
  readonly pulseDurationMs?: number | undefined;
  readonly now?: string | number | Date | undefined;
}

export interface CadenceStepResult {
  readonly decision: RolloverDecision;
  readonly previousState: CadenceState;
  readonly newState: CadenceState;
  readonly executedImmediately: boolean;
  readonly delayMs: number;
  readonly durationMs: number;
  readonly timestamp: string;
}

/**
 * Creates a structured CadenceTrigger with default source and ISO timestamp.
 */
export function createCadenceTrigger(
  type: CadenceTriggerType,
  source: string = "autonomic-cadence",
  payload?: Readonly<Record<string, unknown>>,
  priority: TriggerPriority = "NORMAL",
): CadenceTrigger {
  return {
    type,
    source,
    timestamp: new Date().toISOString(),
    payload,
    priority,
  };
}

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
export function createInitialCadenceState(options: {
  readonly generation?: number | undefined;
  readonly baseIntervalMs?: number | undefined;
  readonly now?: string | number | Date | undefined;
} = {}): CadenceState {
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

/**
 * Autonomous Mind Cadence Engine.
 * Manages the perpetual lifecycle, anti-idle rollover, non-blocking state transitions,
 * and deterministic event telemetry.
 */
export class MindCadenceEngine {
  private state: CadenceState;
  private readonly baseIntervalMs: number;
  private readonly maxIntervalMs: number;
  private readonly maxPauseIntervalMs: number;
  private readonly applyJitter: boolean;
  private readonly random: () => number;
  private readonly dispatcher: CadenceTriggerDispatcher = new CadenceTriggerDispatcher();

  private totalPulseDurationMs: number = 0;
  private totalZeroSleepTransitions: number = 0;
  private lastTriggerType: CadenceTriggerType | null = null;

  constructor(options: MindCadenceEngineOptions = {}) {
    this.baseIntervalMs = options.baseIntervalMs ?? DEFAULT_CADENCE_BASE_INTERVAL_MS;
    this.maxIntervalMs = options.maxIntervalMs ?? DEFAULT_CADENCE_MAX_INTERVAL_MS;
    this.maxPauseIntervalMs = options.maxPauseIntervalMs ?? DEFAULT_MAX_PAUSE_INTERVAL_MS;
    this.applyJitter = options.applyJitter ?? true;
    this.random = options.random ?? Math.random;

    this.state = createInitialCadenceState({
      generation: options.generation,
      baseIntervalMs: this.baseIntervalMs,
    });
  }

  public getState(): CadenceState {
    return { ...this.state };
  }

  public getTelemetry(): CadenceTelemetry {
    const immediateRatio =
      this.state.rolloverCounter > 0
        ? Number((this.state.immediateRolloverCounter / this.state.rolloverCounter).toFixed(3))
        : 1.0;

    const avgPulseDuration =
      this.state.pulseCounter > 0
        ? Math.round(this.totalPulseDurationMs / this.state.pulseCounter)
        : 0;

    return {
      totalPulses: this.state.pulseCounter,
      totalRollovers: this.state.rolloverCounter,
      totalImmediateRollovers: this.state.immediateRolloverCounter,
      immediateRolloverRatio: immediateRatio,
      totalZeroSleepTransitions: this.totalZeroSleepTransitions,
      averagePulseDurationMs: avgPulseDuration,
      quiescenceStreak: this.state.zeroValueStreak,
      lastTriggerType: this.lastTriggerType,
      isAntiIdleActive: this.state.status === "RUNNING",
    };
  }

  public on(listener: CadenceEventListener): () => void {
    return this.dispatcher.subscribe(listener);
  }

  public evaluateRollover(
    trigger: CadenceTrigger = createCadenceTrigger("POLLING" as CadenceTriggerType),
    pendingTasks: number = 0,
    pendingFeedback: number = 0,
  ): RolloverDecision {
    return evaluateAntiIdleRollover({
      trigger,
      pendingTasks,
      pendingFeedback,
      zeroValueStreak: this.state.zeroValueStreak,
      baseIntervalMs: this.baseIntervalMs,
      maxIntervalMs: this.maxIntervalMs,
      maxPauseIntervalMs: this.maxPauseIntervalMs,
      previousIntervalMs: this.state.currentIntervalMs,
      isHalted: this.state.status === "HALTED",
      applyJitter: this.applyJitter,
      random: this.random,
    });
  }

  /**
   * Executes a single autonomic cadence step.
   * Instant non-blocking transition when work is present (delayMs = 0).
   */
  public async step(input: CadenceStepInput = {}): Promise<CadenceStepResult> {
    const startTime = Date.now();
    const nowMs = input.now !== undefined ? new Date(input.now).getTime() : Date.now();
    const nowIso = new Date(nowMs).toISOString();

    const trigger = input.trigger ?? createCadenceTrigger("MANUAL_DISPATCH");
    this.lastTriggerType = trigger.type;

    const decision = evaluateAntiIdleRollover({
      trigger,
      pendingTasks: input.pendingTasks ?? 0,
      pendingFeedback: input.pendingFeedback ?? 0,
      zeroValueStreak: this.state.zeroValueStreak,
      baseIntervalMs: this.baseIntervalMs,
      maxIntervalMs: this.maxIntervalMs,
      maxPauseIntervalMs: this.maxPauseIntervalMs,
      previousIntervalMs: this.state.currentIntervalMs,
      isHalted: this.state.status === "HALTED",
      applyJitter: this.applyJitter,
      random: this.random,
      now: input.now,
    });

    const previousState = { ...this.state };
    const isImmediate = decision.shouldRolloverImmediately;
    const delayMs = isImmediate ? ZERO_SLEEP_DELAY_MS : Math.max(0, decision.targetDelayMs);

    if (isImmediate) {
      this.totalZeroSleepTransitions++;
    }

    const nextRolloverCounter = previousState.rolloverCounter + 1;
    const nextImmediateCounter = isImmediate
      ? previousState.immediateRolloverCounter + 1
      : previousState.immediateRolloverCounter;

    const nextInterval = isImmediate ? 0 : decision.targetDelayMs;
    const nextWakeAt = new Date(nowMs + (isImmediate ? 0 : decision.targetDelayMs)).toISOString();

    let nextPulseCounter = previousState.pulseCounter;
    if (input.pulseOutcome !== undefined) {
      nextPulseCounter++;
      if (typeof input.pulseDurationMs === "number" && input.pulseDurationMs > 0) {
        this.totalPulseDurationMs += input.pulseDurationMs;
      }
    }

    const nextState: CadenceState = {
      status: decision.targetPhase === "HALTED" ? "HALTED" : "RUNNING",
      currentPhase: decision.targetPhase,
      generation: previousState.generation,
      pulseCounter: nextPulseCounter,
      rolloverCounter: nextRolloverCounter,
      immediateRolloverCounter: nextImmediateCounter,
      zeroValueStreak: decision.zeroValueStreak,
      lastPulseAt: input.pulseOutcome !== undefined ? nowIso : previousState.lastPulseAt,
      lastRolloverAt: nowIso,
      currentIntervalMs: nextInterval,
      nextWakeAt,
      infiniteCadenceEnforced: true,
      closing_permitted: false,
      invariant: CLOSING_FORBIDDEN_FOR_MIND,
    };

    this.state = nextState;

    const durationMs = Date.now() - startTime;

    const event: CadenceEvent = {
      type: isImmediate ? "ROLLOVER_EXECUTED" : "STATE_TRANSITION",
      previousPhase: previousState.currentPhase,
      currentPhase: nextState.currentPhase,
      trigger,
      decision,
      state: nextState,
      timestamp: nowIso,
    };

    await this.dispatcher.dispatch(event);

    return {
      decision,
      previousState,
      newState: nextState,
      executedImmediately: isImmediate,
      delayMs,
      durationMs,
      timestamp: nowIso,
    };
  }

  public halt(reason: string = "Safety halt"): void {
    const nowIso = new Date().toISOString();
    this.state = {
      ...this.state,
      status: "HALTED",
      currentPhase: "HALTED",
      currentIntervalMs: 0,
      nextWakeAt: nowIso,
    };
    void this.dispatcher.dispatch({
      type: "STATE_TRANSITION",
      previousPhase: this.state.currentPhase,
      currentPhase: "HALTED",
      trigger: createCadenceTrigger("SAFETY_HALT", "safety", { reason }),
      state: this.state,
      timestamp: nowIso,
    });
  }

  public resume(): void {
    const nowIso = new Date().toISOString();
    this.state = {
      ...this.state,
      status: "RUNNING",
      currentPhase: "ACTIVE",
      currentIntervalMs: this.baseIntervalMs,
      nextWakeAt: new Date(Date.now() + this.baseIntervalMs).toISOString(),
    };
  }
}
