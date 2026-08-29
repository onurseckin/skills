import { HarnessError } from "../../../core/errors/index.ts";
import { DEFAULT_MAX_PAUSE_INTERVAL_MS } from "../interval/index.ts";
import {
  DEFAULT_CADENCE_BASE_INTERVAL_MS,
  DEFAULT_CADENCE_MAX_INTERVAL_MS,
  ZERO_SLEEP_DELAY_MS,
  PERPETUAL_NON_STOPPING_CADENCE,
  CLOSING_FORBIDDEN_FOR_MIND,
  createCadenceTrigger,
} from "./types.ts";
import type {
  CadenceEvent,
  CadenceEventListener,
  CadencePhase,
  CadenceState,
  CadenceTelemetry,
  CadenceTrigger,
  CadenceTriggerType,
  RolloverDecision,
  RolloverEvaluationOptions,
  CadenceStepInput,
  CadenceStepResult,
} from "./types.ts";
import type { MindCadenceEngineOptions } from "./state.ts";
import {
  CadenceTriggerDispatcher,
  createInitialCadenceState,
  enforceInfiniteMindCadence,
  evaluateAntiIdleRollover,
} from "./state.ts";

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
